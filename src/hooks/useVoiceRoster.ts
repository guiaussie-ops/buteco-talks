import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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

    inFlightRef.current = true;
    pendingRef.current = [];

    void supabase
      .from("voice_participants")
      .select("channel_id, user_id")
      .in("channel_id", Array.from(idsRef.current))
      .then(({ data, error }) => {
        if (error) console.error("Falha ao ler quem está nas mesas de voz", error);
        // Um fetch mais novo (ou o desmonte) já assumiu: esta resposta é obsoleta.
        if (!active) return;

        let next: Roster = {};
        ((data ?? []) as Row[]).forEach((r) => {
          (next[r.channel_id] ??= []).push(r.user_id);
        });
        for (const op of pendingRef.current) next = applyOp(next, op);

        inFlightRef.current = false;
        pendingRef.current = [];
        setRoster(next);
      });

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
      inFlightRef.current = false;
      pendingRef.current = [];
      void supabase.removeChannel(chan);
    };
  }, [serverId, key, selfChannelId]);

  return roster;
}
