import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SWEEP_MS } from "@/lib/voicePresence";

type Row = { id: string; channel_id: string; user_id: string };
type Op = { kind: "add"; row: Row } | { kind: "remove"; id: string };
/** Linhas de presença por id da linha. */
type Linhas = Record<string, Row>;
type Roster = Record<string, string[]>;

function applyOp(map: Linhas, op: Op): Linhas {
  if (op.kind === "add") {
    if (map[op.row.id]) return map;
    return { ...map, [op.row.id]: op.row };
  }
  if (!map[op.id]) return map;
  const { [op.id]: _, ...resto } = map;
  return resto;
}

/**
 * Quem está em cada mesa de voz do buteco, ao vivo.
 *
 * A leitura é liberada a qualquer membro pela policy "members read voice", então
 * a lista aparece mesmo para quem não entrou na mesa. O filtro do Realtime só
 * aceita uma igualdade, então assinamos a tabela e recortamos no cliente — o RLS
 * já garante que só chegam linhas dos butecos em que a pessoa está.
 *
 * A lista é guardada POR ID DA LINHA, e não por mesa. Com RLS ligado, o
 * Realtime manda o DELETE só com a chave primária no `old` — sem `channel_id`
 * nem `user_id`. Recortar por mesa jogava esses eventos fora, e quem trocava de
 * mesa ficava sentado nas duas até a releitura periódica, uns 30 s depois.
 */
export function useVoiceRoster(
  serverId: string | null,
  channelIds: string[],
  /** mesa em que EU estou — mudou, refaz a leitura para não depender só do Realtime */
  selfChannelId: string | null,
) {
  const [linhas, setLinhas] = useState<Linhas>({});
  const key = channelIds.join(",");
  const idsRef = useRef<Set<string>>(new Set());
  idsRef.current = new Set(channelIds);

  // Eventos que chegam enquanto um fetch está em voo. A resposta do fetch reflete
  // o banco de quando ela partiu, então aplicá-la crua ressuscitaria quem já saiu
  // (o "fantasma" numa troca rápida de mesa). Guardamos os eventos e reaplicamos
  // sobre a resposta, em vez de descartá-la — descartar perderia participantes
  // que o fetch trouxe e o Realtime não vai reenviar.
  const inFlightRef = useRef(false);
  const pendingRef = useRef<Op[]>([]);

  useEffect(() => {
    if (!serverId || idsRef.current.size === 0) {
      setLinhas({});
      return;
    }
    let active = true;

    /**
     * Varre os vencidos e relê a lista inteira do banco.
     *
     * Roda na montagem e de tempos em tempos. A releitura periódica é o que
     * torna a lista auto-corrigível: um único evento perdido não deixa mais um
     * fantasma na tela até a pessoa trocar de sala. O pior caso é um ciclo de
     * atraso.
     */
    const sincronizar = async () => {
      inFlightRef.current = true;
      pendingRef.current = [];
      try {
        // Varre antes de ler: assim a lista já nasce sem fantasma, em vez de
        // mostrar um e corrigir quando o DELETE chegar pelo Realtime.
        const { error: sweepError } = await supabase.rpc("voice_sweep");
        if (sweepError) console.error("Falha ao varrer presenças de voz vencidas", sweepError);

        const { data, error } = await supabase
          .from("voice_participants")
          .select("id, channel_id, user_id")
          .in("channel_id", Array.from(idsRef.current));
        if (error) console.error("Falha ao ler quem está nas mesas de voz", error);
        // Uma sincronização mais nova (ou o desmonte) já assumiu: resposta velha.
        if (!active) return;
        // Leitura que falhou não apaga a lista que já estava na tela.
        if (error) return;

        let next: Linhas = {};
        ((data ?? []) as Row[]).forEach((r) => {
          next[r.id] = r;
        });
        // Eventos que chegaram durante a leitura valem por cima dela.
        for (const op of pendingRef.current) next = applyOp(next, op);
        setLinhas(next);
      } finally {
        // No finally para uma falha de rede não deixar a lista presa achando
        // que existe leitura em voo para sempre.
        inFlightRef.current = false;
        pendingRef.current = [];
      }
    };

    void sincronizar();
    const reconciliacao = window.setInterval(() => void sincronizar(), SWEEP_MS);

    const apply = (op: Op) => {
      if (op.kind === "add" && !idsRef.current.has(op.row.channel_id)) return;
      if (inFlightRef.current) pendingRef.current.push(op);
      setLinhas((prev) => applyOp(prev, op));
    };

    const chan = supabase
      .channel(`voice-roster:${serverId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "voice_participants" },
        (payload) => {
          const r = payload.new as Partial<Row>;
          if (r.id && r.channel_id && r.user_id)
            apply({ kind: "add", row: { id: r.id, channel_id: r.channel_id, user_id: r.user_id } });
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "voice_participants" },
        (payload) => {
          // Só o id vem garantido aqui (ver o comentário do hook).
          const r = payload.old as Partial<Row>;
          if (r.id) apply({ kind: "remove", id: r.id });
        },
      )
      .subscribe();

    return () => {
      active = false;
      window.clearInterval(reconciliacao);
      inFlightRef.current = false;
      pendingRef.current = [];
      void supabase.removeChannel(chan);
    };
  }, [serverId, key, selfChannelId]);

  return useMemo(() => {
    const roster: Roster = {};
    for (const r of Object.values(linhas)) {
      const cur = (roster[r.channel_id] ??= []);
      if (!cur.includes(r.user_id)) cur.push(r.user_id);
    }
    return roster;
  }, [linhas]);
}
