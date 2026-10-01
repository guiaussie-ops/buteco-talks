import { useEffect, useRef } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type NaoLidas = Record<string, { naoLidas: number; mencoes: number }>;

const chave = (serverId: string) => ["nao-lidas", serverId] as const;

/** A mesa aberta e lida sai do selo na hora, sem esperar a recontagem. */
export function zerarNaoLidas(qc: QueryClient, serverId: string, channelId: string) {
  qc.setQueryData<NaoLidas>(chave(serverId), (prev) =>
    prev && prev[channelId] && (prev[channelId].naoLidas > 0 || prev[channelId].mencoes > 0)
      ? { ...prev, [channelId]: { naoLidas: 0, mencoes: 0 } }
      : prev,
  );
}

/**
 * Não lidas e menções por mesa de texto do buteco.
 *
 * A contagem vem do banco (`nao_lidas`) e é refeita quando chega mensagem de
 * outra pessoa numa mesa do buteco. A exceção é a mesa aberta com a aba à vista:
 * ali o ChatPanel marca como lida na hora, e recontar só faria o selo piscar.
 */
export function useNaoLidas(
  serverId: string | null,
  userId: string | null,
  mesaAberta: string | null,
) {
  const qc = useQueryClient();
  const mesaAbertaRef = useRef(mesaAberta);
  mesaAbertaRef.current = mesaAberta;

  const query = useQuery({
    queryKey: chave(serverId ?? ""),
    enabled: !!serverId && !!userId,
    queryFn: async (): Promise<NaoLidas> => {
      const { data, error } = await supabase.rpc("nao_lidas", { _server_id: serverId! });
      if (error) throw error;
      const saida: NaoLidas = {};
      (data ?? []).forEach((r) => {
        saida[r.channel_id] = { naoLidas: r.nao_lidas, mencoes: r.mencoes };
      });
      return saida;
    },
  });

  useEffect(() => {
    if (!serverId || !userId) return;
    let espera: number | undefined;
    // Uma rajada de mensagens vira uma recontagem só.
    const recontar = () => {
      window.clearTimeout(espera);
      espera = window.setTimeout(
        () => void qc.invalidateQueries({ queryKey: chave(serverId) }),
        400,
      );
    };

    const canal = supabase
      .channel(`nao-lidas:${serverId}`)
      // Sem filtro: o RLS já entrega só mensagens de butecos onde eu sento, e
      // a lista de mesas deste buteco está na própria contagem.
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const msg = payload.new as { channel_id: string; user_id: string };
          if (msg.user_id === userId) return;
          const atual = qc.getQueryData<NaoLidas>(chave(serverId));
          if (atual && !(msg.channel_id in atual)) return;
          if (msg.channel_id === mesaAbertaRef.current && document.visibilityState === "visible")
            return;
          recontar();
        },
      )
      .subscribe();

    return () => {
      window.clearTimeout(espera);
      void supabase.removeChannel(canal);
    };
  }, [serverId, userId, qc]);

  return query.data ?? {};
}
