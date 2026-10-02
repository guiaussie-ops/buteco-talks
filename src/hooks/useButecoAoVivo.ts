import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Mantém mesas, categorias e membros do buteco aberto em dia sem recarregar:
 * a arrumação que um admin fez, o cargo novo de alguém, quem entrou e quem
 * foi expulso — inclusive eu, que preciso sumir da tela do buteco na hora.
 *
 * Não tenta aplicar o payload: só manda recarregar a query certa. São tabelas
 * pequenas e o evento é raro, então simplicidade ganha de economia.
 */
export function useButecoAoVivo(serverId: string | null, userId: string | null) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!serverId || !userId) return;
    const timers = new Map<string, number>();
    // Uma arrumação grava várias linhas de uma vez: vira uma recarga só.
    const recarregar = (queryKey: readonly unknown[]) => {
      const chave = JSON.stringify(queryKey);
      window.clearTimeout(timers.get(chave));
      timers.set(
        chave,
        window.setTimeout(() => void qc.invalidateQueries({ queryKey }), 250),
      );
    };

    const canal = supabase
      .channel(`buteco:${serverId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "channels", filter: `server_id=eq.${serverId}` },
        () => recarregar(["channels", serverId]),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "channel_categories",
          filter: `server_id=eq.${serverId}`,
        },
        () => recarregar(["categorias", serverId]),
      )
      // DELETE chega sem filtro e só com o id: não dá para saber de qual buteco
      // nem de quem era. Por isso a saída de qualquer pessoa recarrega também a
      // minha lista de butecos — se fui eu, o buteco some dela.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "channels" }, () =>
        recarregar(["channels", serverId]),
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "channel_categories" },
        () => recarregar(["categorias", serverId]),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "server_members",
          filter: `server_id=eq.${serverId}`,
        },
        () => {
          recarregar(["members", serverId]);
          recarregar(["servers", userId]);
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "server_members" },
        () => {
          recarregar(["members", serverId]);
          recarregar(["servers", userId]);
        },
      )
      .subscribe();

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      void supabase.removeChannel(canal);
    };
  }, [serverId, userId, qc]);
}
