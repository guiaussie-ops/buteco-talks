import { useMemo } from "react";
import { useVoice } from "@/lib/voice";
import { montarBlocos, type Categoria } from "@/lib/organizacao";
import type { NaoLidas } from "@/hooks/useNaoLidas";
import type { Channel } from "@/components/app/ChannelSidebar";
import { MesaDoSalao } from "@/components/app/Mesas";

/**
 * O salão visto de cima: a porta de entrada do buteco. Cada categoria é uma
 * área do salão com a sua plaquinha, e as mesas aparecem como mesas — as de
 * voz com quem está sentado em volta, as de texto com a comanda dizendo se tem
 * coisa nova. Clicar numa mesa entra nela.
 *
 * A planta sai sozinha das mesas que existem: ninguém precisa desenhar nada.
 */
export function Salao({
  channels,
  categorias,
  roster,
  naoLidas,
  names,
  avatars,
  onEntrar,
}: {
  channels: Channel[];
  categorias: Categoria[];
  roster: Record<string, string[]>;
  naoLidas: NaoLidas;
  names: Record<string, string>;
  avatars: Record<string, string | null>;
  onEntrar: (c: Channel) => void;
}) {
  const voice = useVoice();
  const blocos = useMemo(() => montarBlocos(categorias, channels), [categorias, channels]);
  const sentadosNoBar = new Set(Object.values(roster).flat()).size;

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <header className="border-border bg-rail/90 flex h-14 shrink-0 items-center gap-3 border-b px-5">
        <h1 className="font-display text-2xl tracking-wide">Salão</h1>
        <span className="text-muted-foreground text-xs">
          {channels.length} {channels.length === 1 ? "mesa" : "mesas"}
          {sentadosNoBar > 0 &&
            ` · ${sentadosNoBar} ${sentadosNoBar === 1 ? "pessoa sentada" : "pessoas sentadas"}`}
        </span>
        <span className="text-muted-foreground ml-auto hidden text-xs sm:block">
          clique numa mesa pra entrar
        </span>
      </header>

      <div className="piso-de-madeira scrollbar-thin flex-1 overflow-y-auto px-6 py-6 sm:px-10">
        {channels.length === 0 && (
          <div className="bg-rail/85 mx-auto mt-16 max-w-sm rounded-xl p-6 text-center">
            <p className="font-display text-2xl tracking-wide">Salão vazio</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Ainda não tem mesa nenhuma. Quem cuida do buteco pode botar a primeira pela barra da
              esquerda.
            </p>
          </div>
        )}
        <div className="flex flex-col gap-10">
          {blocos
            .filter((b) => b.mesas.length > 0)
            .map((b) => (
              <section key={b.categoria?.id ?? "soltas"} className="flex flex-col gap-4">
                {b.categoria && (
                  <h2 className="bg-rail/85 text-foreground/90 font-display w-fit rounded-md px-3 py-1 text-lg tracking-[0.12em] uppercase shadow-md">
                    {b.categoria.name}
                  </h2>
                )}
                <div className="flex flex-wrap items-start gap-x-10 gap-y-6">
                  {b.mesas.map((c) => {
                    if (c.kind === "voice") {
                      const ids = roster[c.id] ?? [];
                      const naMinha = voice.active?.channelId === c.id;
                      return (
                        <MesaDoSalao
                          key={c.id}
                          tipo="voice"
                          nome={c.name}
                          minha={naMinha}
                          sentados={ids.map((id) => ({
                            id,
                            nome: names[id] ?? "Participante",
                            avatar: avatars[id],
                            // Quem fala só é conhecido na mesa em que eu estou.
                            falando: naMinha && !!voice.speaking[id],
                          }))}
                          onEntrar={() => onEntrar(c)}
                        />
                      );
                    }
                    const pendente = naoLidas[c.id];
                    return (
                      <MesaDoSalao
                        key={c.id}
                        tipo="text"
                        nome={c.name}
                        naoLidas={pendente?.naoLidas ?? 0}
                        mencoes={pendente?.mencoes ?? 0}
                        onEntrar={() => onEntrar(c)}
                      />
                    );
                  })}
                </div>
              </section>
            ))}
        </div>
      </div>
    </section>
  );
}
