import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { descreverAcao, quandoFoi, tipoDaAcao, type TipoDeAcao } from "@/lib/historico";
import { cn } from "@/lib/utils";
import { Bottlecap } from "@/components/Bottlecap";
import { Button } from "@/components/ui/button";

const PAGINA = 50;

const FILTROS: { valor: TipoDeAcao | "tudo"; rotulo: string }[] = [
  { valor: "tudo", rotulo: "Tudo" },
  { valor: "membros", rotulo: "Membros" },
  { valor: "convites", rotulo: "Convites" },
  { valor: "buteco", rotulo: "Buteco e mesas" },
];

/**
 * Quem mexeu em quê, do mais novo para o mais antigo. Carrega de 50 em 50:
 * o banco devolve o que veio antes do último item que a tela já tem.
 * Recarrega sozinho cada vez que a aba abre (a aba desmonta quando sai).
 */
export function HistoricoDaGestao({ serverId }: { serverId: string }) {
  const [filtro, setFiltro] = useState<TipoDeAcao | "tudo">("tudo");
  const query = useInfiniteQuery({
    queryKey: ["historico", serverId],
    initialPageParam: null as number | null,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc("historico_da_gestao", {
        _server_id: serverId,
        _limite: PAGINA,
        ...(pageParam !== null ? { _antes_id: pageParam } : {}),
      });
      if (error) throw error;
      return data ?? [];
    },
    getNextPageParam: (ultima) =>
      ultima.length < PAGINA ? null : (ultima[ultima.length - 1]?.id ?? null),
  });

  const acoes = (query.data?.pages.flat() ?? []).filter(
    (a) => filtro === "tudo" || tipoDaAcao(a.acao) === filtro,
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {FILTROS.map((f) => (
          <button
            key={f.valor}
            type="button"
            onClick={() => setFiltro(f.valor)}
            aria-pressed={filtro === f.valor}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
              filtro === f.valor
                ? "border-primary bg-primary/15 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {f.rotulo}
          </button>
        ))}
      </div>

      <ul className="scrollbar-thin -mx-1 max-h-[50vh] space-y-0.5 overflow-y-auto px-1">
        {acoes.map((a) => {
          const { frase, detalhe } = descreverAcao(a);
          const autor = a.autor_nome || "Alguém";
          return (
            <li key={a.id} className="flex items-start gap-3 rounded-lg px-2 py-1.5">
              <Bottlecap
                name={autor}
                src={a.autor_avatar}
                className="mt-0.5 size-7 shrink-0 text-[10px]"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug">
                  <span className="font-medium">{autor}</span>{" "}
                  <span className="text-foreground/85">{frase}</span>
                </p>
                {detalhe && <p className="text-muted-foreground text-xs">{detalhe}</p>}
              </div>
              <time
                dateTime={a.created_at}
                title={new Date(a.created_at).toLocaleString("pt-BR")}
                className="text-muted-foreground shrink-0 pt-0.5 text-[11px]"
              >
                {quandoFoi(a.created_at)}
              </time>
            </li>
          );
        })}
        {query.isSuccess && acoes.length === 0 && (
          <li className="text-muted-foreground py-6 text-center text-sm">
            {filtro === "tudo"
              ? "Nada anotado ainda. Daqui pra frente, toda mudança da gestão aparece aqui."
              : "Nada desse tipo por enquanto."}
          </li>
        )}
        {query.isError && (
          <li className="text-muted-foreground py-6 text-center text-sm">
            Não consegui carregar o histórico.{" "}
            <button className="text-primary hover:underline" onClick={() => void query.refetch()}>
              Tentar de novo
            </button>
          </li>
        )}
      </ul>

      {query.hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? "Carregando..." : "Ver mais antigos"}
        </Button>
      )}
    </div>
  );
}
