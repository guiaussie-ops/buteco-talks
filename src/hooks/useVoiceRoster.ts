import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SWEEP_MS } from "@/lib/voicePresence";

type Row = { channel_id: string; user_id: string };
type Op = { kind: "add" | "remove"; channelId: string; userId: string };
type Roster = Record<string, string[]>;

function applyOp(map: Roster, op: Op): Roster {
  const cur = map[op.channelId] ?? [];
  if (op.kind === "add") {
    if (cur.includes(op.userId)) return map;
    return { ...map, [op.channelId]: [...cur, op.userId] };
  }
  if (!cur.includes(op.userId)) return map;
  return { ...map, [op.channelId]: cur.filter((u) => u !== op.userId) };
}

/**
 * Quem está em cada mesa de voz do buteco, ao vivo.
 *
 * A leitura é liberada a qualquer membro pela policy "members read voice", então
 * a lista aparece mesmo para quem não entrou na mesa. O filtro do Realtime só
 * aceita uma igualdade, então assinamos a tabela e recortamos no cliente — o RLS
 * já garante que só chegam linhas dos butecos em que a pessoa está.
 */
export function useVoiceRoster(
  serverId: string | null,
  channelIds: string[],
  /** mesa em que EU estou — mudou, refaz a leitura para não depender só do Realtime */
  selfChannelId: string | null,
) {
  const [roster, setRoster] = useState<Roster>({});
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
      setRoster({});
      return;
    }
    let active = true;

    /**
     * Varre os vencidos e relê a lista inteira do banco.
     *
     * Roda na montagem e de tempos em tempos. A releitura periódica é o que
     * torna a lista auto-corrigível: antes ela nascia de um fetch e depois vivia
     * só de eventos do Realtime, então um único evento perdido deixava um
     * fantasma na tela até a pessoa trocar de sala. Agora o pior caso é um
     * ciclo de atraso.
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
          .select("channel_id, user_id")
          .in("channel_id", Array.from(idsRef.current));
        if (error) console.error("Falha ao ler quem está nas mesas de voz", error);
        // Uma sincronização mais nova (ou o desmonte) já assumiu: resposta velha.
        if (!active) return;

        let next: Roster = {};
        ((data ?? []) as Row[]).forEach((r) => {
          (next[r.channel_id] ??= []).push(r.user_id);
        });
        // Eventos que chegaram durante a leitura valem por cima dela.
        for (const op of pendingRef.current) next = applyOp(next, op);
        setRoster(next);
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
      if (!idsRef.current.has(op.channelId)) return;
      if (inFlightRef.current) pendingRef.current.push(op);
      setRoster((prev) => applyOp(prev, op));
    };

    const chan = supabase
      .channel(`voice-roster:${serverId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "voice_participants" },
        (payload) => {
          const r = payload.new as Row;
          if (r.channel_id && r.user_id)
            apply({ kind: "add", channelId: r.channel_id, userId: r.user_id });
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "voice_participants" },
        (payload) => {
          const r = payload.old as Partial<Row>;
          if (r.channel_id && r.user_id)
            apply({ kind: "remove", channelId: r.channel_id, userId: r.user_id });
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

  return roster;
}
