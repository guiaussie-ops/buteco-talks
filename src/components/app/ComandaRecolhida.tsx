import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/**
 * A mesa de texto que ficou para trás quando uma transmissão foi para a tela
 * cheia, dobrada como um papelzinho no pé da coluna da direita: quantas novas,
 * a última mensagem e o caminho de volta pro chat.
 *
 * A última mensagem é rebuscada sempre que a contagem de novas muda — é a
 * recontagem de `useNaoLidas` que avisa que chegou coisa nessa mesa.
 */
export function ComandaRecolhida({
  channelId,
  nome,
  naoLidas,
  mencoes,
  names,
  onVoltar,
}: {
  channelId: string;
  nome: string;
  naoLidas: number;
  mencoes: number;
  names: Record<string, string>;
  onVoltar: () => void;
}) {
  const ultima = useQuery({
    queryKey: ["ultima-mensagem", channelId, naoLidas],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("user_id, content, image_path")
        .eq("channel_id", channelId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const situacao =
    mencoes > 0
      ? `@você · ${mencoes > 99 ? "99+" : mencoes}`
      : naoLidas > 0
        ? `${naoLidas > 99 ? "99+" : naoLidas} ${naoLidas === 1 ? "nova" : "novas"}`
        : null;

  const msg = ultima.data;
  const texto = msg ? msg.content.trim() || (msg.image_path ? "[foto]" : "") : "";

  return (
    <div className="shrink-0 p-3">
      <div className="bg-papel text-papel-tinta border-papel-linha flex flex-col gap-1.5 rounded-sm border-t-[3px] border-dotted px-3 py-2.5 shadow-[0_8px_20px_rgb(0_0_0/0.45)]">
        <div className="flex items-center gap-2">
          <span className="font-display min-w-0 flex-1 truncate text-xl leading-none tracking-wide">
            #{nome}
          </span>
          {situacao && (
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 text-[10px] font-bold",
                mencoes > 0
                  ? "bg-destructive text-destructive-foreground"
                  : "bg-primary text-primary-foreground",
              )}
            >
              {situacao}
            </span>
          )}
        </div>
        {msg && texto ? (
          <p className="line-clamp-2 text-xs leading-snug">
            <b>{names[msg.user_id] ?? "Alguém"}:</b> {texto}
          </p>
        ) : (
          !ultima.isPending && (
            <p className="text-papel-tinta/60 text-xs">ninguém falou nada ainda</p>
          )
        )}
        <button
          type="button"
          onClick={onVoltar}
          className="w-fit text-xs font-bold text-[oklch(0.45_0.13_45)] underline-offset-2 hover:underline"
        >
          voltar pro chat
        </button>
      </div>
    </div>
  );
}
