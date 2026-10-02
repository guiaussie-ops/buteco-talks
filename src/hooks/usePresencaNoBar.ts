import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { statusDe, type Status } from "@/lib/status";
import { tocarChegada } from "@/lib/sons";

/**
 * Quem está com o app aberto neste buteco agora, e com que status. É a lista
 * de contatos online do MSN.
 *
 * Também dá o aviso de "Fulano acabou de entrar". Só para quem entra DEPOIS de
 * mim: a primeira sincronização traz todo mundo que já estava lá, e avisar um
 * por um seria um pipoco de toasts a cada troca de buteco.
 *
 * Quem está "invisível" não entra na presença: usa o app sem aparecer e sem
 * disparar aviso, que é o "aparecer offline" do MSN.
 */
export function usePresencaNoBar({
  serverId,
  serverName,
  meuId,
  meuStatus,
  nomeDe,
  comSom,
}: {
  serverId: string | null;
  serverName: string;
  meuId: string | null;
  meuStatus: string;
  nomeDe: (userId: string) => string;
  /** Tocar o "tssss" quando alguém chega. */
  comSom: boolean;
}) {
  const [online, setOnline] = useState<Record<string, Status>>({});
  const canalRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const nomeDeRef = useRef(nomeDe);
  nomeDeRef.current = nomeDe;
  const serverNameRef = useRef(serverName);
  serverNameRef.current = serverName;
  const status = statusDe(meuStatus);
  const statusRef = useRef(status);
  statusRef.current = status;
  const comSomRef = useRef(comSom);
  comSomRef.current = comSom;

  useEffect(() => {
    if (!serverId || !meuId) {
      setOnline({});
      return;
    }
    let pronto = false;
    // Espera a primeira sincronização assentar antes de começar a avisar.
    const assentar = window.setTimeout(() => {
      pronto = true;
    }, 3000);

    const canal = supabase.channel(`bar:${serverId}`, { config: { presence: { key: meuId } } });
    canalRef.current = canal;

    canal
      .on("presence", { event: "sync" }, () => {
        const estado = canal.presenceState<{ status?: string }>();
        const proximo: Record<string, Status> = {};
        for (const [id, entradas] of Object.entries(estado)) {
          const ultima = entradas[entradas.length - 1];
          proximo[id] = statusDe(ultima?.status);
        }
        setOnline(proximo);
      })
      .on("presence", { event: "join" }, ({ key }) => {
        if (!pronto || key === meuId) return;
        toast(`${nomeDeRef.current(key)} acabou de entrar no ${serverNameRef.current}`, {
          duration: 4000,
        });
        if (comSomRef.current) tocarChegada();
      })
      .subscribe((estado) => {
        if (estado === "SUBSCRIBED" && statusRef.current !== "invisivel") {
          void canal.track({ status: statusRef.current });
        }
      });

    return () => {
      window.clearTimeout(assentar);
      canalRef.current = null;
      void supabase.removeChannel(canal);
    };
  }, [serverId, meuId]);

  // Mudou o status: atualiza na presença, ou sai dela se ficou invisível.
  useEffect(() => {
    const canal = canalRef.current;
    if (!canal) return;
    if (status === "invisivel") void canal.untrack();
    else void canal.track({ status });
  }, [status]);

  return online;
}
