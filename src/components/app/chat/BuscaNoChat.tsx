import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Bottlecap } from "@/components/Bottlecap";
import { destacar, formatDay, formatTime, type Message } from "@/lib/chat";

/** Tempo sem digitar até a busca sair, para não buscar letra por letra. */
const ESPERA_MS = 300;
/** O mesmo mínimo de `buscar_mensagens`: uma letra só acharia a mesa inteira. */
const MINIMO = 2;

/**
 * A busca da mesa de texto: um painel por cima do chat, debaixo do cabeçalho.
 * Procura no banco (sem acento e sem caixa), mostra as 50 mais recentes que
 * batem e, ao escolher uma, quem chamou leva o chat até ela.
 */
export function BuscaNoChat({
  channelId,
  channelName,
  names,
  avatars,
  onEscolher,
  onFechar,
}: {
  channelId: string;
  channelName: string;
  names: Record<string, string>;
  avatars: Record<string, string | null>;
  onEscolher: (msg: Message) => void;
  onFechar: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [termo, setTermo] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setTermo(texto.trim()), ESPERA_MS);
    return () => window.clearTimeout(t);
  }, [texto]);

  const busca = useQuery({
    queryKey: ["busca-no-chat", channelId, termo],
    enabled: termo.length >= MINIMO,
    staleTime: 30_000,
    queryFn: async (): Promise<Message[]> => {
      const { data, error } = await supabase.rpc("buscar_mensagens", {
        _channel_id: channelId,
        _termo: termo,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const resultados = busca.data ?? [];
  const esperando = texto.trim() !== termo || (termo.length >= MINIMO && busca.isPending);

  return (
    <div
      className="border-border bg-background/95 absolute inset-x-0 top-14 bottom-0 z-20 flex flex-col backdrop-blur-sm sm:inset-x-auto sm:right-0 sm:w-[26rem] sm:border-l"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onFechar();
        }
      }}
    >
      <div className="border-border flex items-center gap-2 border-b px-3 py-2.5">
        <Search className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
        <label htmlFor="busca-no-chat" className="sr-only">
          Buscar em #{channelName}
        </label>
        <input
          id="busca-no-chat"
          ref={inputRef}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={`Buscar em #${channelName}`}
          autoComplete="off"
          className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar a busca"
          title="Fechar (Esc)"
          className="text-muted-foreground hover:text-foreground hover:bg-surface-2 rounded-md p-1.5"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto p-2" aria-live="polite">
        {termo.length < MINIMO ? (
          <p className="text-muted-foreground px-2 py-6 text-center text-sm">
            Digite pelo menos duas letras. Acento e maiúscula não importam.
          </p>
        ) : esperando ? (
          <p className="text-muted-foreground px-2 py-6 text-center text-sm">Procurando…</p>
        ) : busca.isError ? (
          <p className="text-muted-foreground px-2 py-6 text-center text-sm">
            A busca falhou. Tenta de novo daqui a pouco.
          </p>
        ) : resultados.length === 0 ? (
          <p className="text-muted-foreground px-2 py-6 text-center text-sm">
            Nada com “{termo}” nesta mesa.
          </p>
        ) : (
          <>
            <p className="text-muted-foreground px-2 pt-1 pb-2 text-xs">
              {resultados.length === 50
                ? "As 50 mais recentes"
                : `${resultados.length} ${resultados.length === 1 ? "mensagem" : "mensagens"}`}
            </p>
            <ul className="flex flex-col gap-1">
              {resultados.map((m) => {
                const nome = names[m.user_id] ?? "Alguém";
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => onEscolher(m)}
                      className="hover:bg-surface-2 flex w-full gap-2.5 rounded-lg px-2 py-2 text-left"
                    >
                      <Bottlecap
                        name={nome}
                        src={avatars[m.user_id] ?? null}
                        className="mt-0.5 size-8 shrink-0 text-xs"
                      />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="flex items-baseline gap-2">
                          <span className="truncate text-sm font-semibold">{nome}</span>
                          <span className="text-muted-foreground shrink-0 text-[11px]">
                            {formatDay(m.created_at)} às {formatTime(m.created_at)}
                          </span>
                        </span>
                        <span className="text-foreground/90 line-clamp-3 text-sm break-words">
                          {destacar(m.content, termo).map((p, i) =>
                            p.destaque ? (
                              <mark
                                key={i}
                                className="bg-primary/30 text-foreground rounded-sm px-0.5"
                              >
                                {p.texto}
                              </mark>
                            ) : (
                              <span key={i}>{p.texto}</span>
                            ),
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
