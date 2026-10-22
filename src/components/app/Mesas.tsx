import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { corDaTampinha } from "@/lib/tampinha";
import { mobiliaDaMesa } from "@/lib/mobilia";
import { Bottlecap } from "@/components/Bottlecap";

/**
 * As mesas do buteco desenhadas como mesas. É a peça que tira a cara de lista
 * de canais: a de texto é quadrada com a comanda de papel em cima, a de voz é
 * redonda com as tampinhas de quem está sentado em volta.
 *
 * Duas escalas do mesmo desenho: a miniatura da barra lateral e a mesa grande
 * da planta do salão. Na grande, a de voz vira mobília de buteco de verdade:
 * plástico da cervejaria ou fórmica antiga, cada uma com as suas cadeiras.
 */

/** Lugares em volta da mesa redonda, em fração do lado: cima, direita, baixo, esquerda e diagonais. */
const LUGARES = [
  [0.5, 0],
  [1, 0.5],
  [0.5, 1],
  [0, 0.5],
  [0.85, 0.15],
  [0.15, 0.85],
  [0.85, 0.85],
  [0.15, 0.15],
] as const;

export function MiniMesa({
  tipo,
  sentados = [],
  apagada,
  className,
}: {
  tipo: "text" | "voice";
  /** Nomes de quem está sentado, para pintar as bolinhas com a cor de cada um. */
  sentados?: string[];
  /** Mesa sem nada acontecendo: o tampo escurece. */
  apagada?: boolean;
  className?: string;
}) {
  if (tipo === "text") {
    return (
      <span
        aria-hidden
        className={cn(
          "border-mesa-borda relative inline-block h-6 w-[30px] shrink-0 rounded-[4px] border-[3px]",
          apagada ? "bg-mesa/70" : "bg-mesa",
          className,
        )}
      >
        <span
          className={cn(
            "absolute top-[2px] left-[5px] h-2.5 w-3 -rotate-6",
            apagada ? "bg-papel/70" : "bg-papel",
          )}
        />
      </span>
    );
  }
  return (
    <span aria-hidden className={cn("relative inline-block size-[30px] shrink-0", className)}>
      <span
        className={cn(
          "border-mesa-borda absolute inset-1 rounded-full border-[3px]",
          apagada ? "bg-mesa/70" : "bg-mesa",
        )}
      />
      {sentados.slice(0, 4).map((nome, i) => (
        <span
          key={`${nome}-${i}`}
          className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            left: `${LUGARES[i]![0] * 100}%`,
            top: `${LUGARES[i]![1] * 100}%`,
            background: corDaTampinha(nome).cap,
          }}
        />
      ))}
    </span>
  );
}

export type Sentado = {
  id: string;
  nome: string;
  avatar: string | null | undefined;
  falando: boolean;
};

/** Posição da cadeira i de n em volta de uma mesa redonda, em % do quadrado. */
function emVolta(i: number, total: number) {
  const angulo = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(total, 1);
  return { left: 50 + 41 * Math.cos(angulo), top: 50 + 41 * Math.sin(angulo) };
}

/**
 * Mesa grande, a da planta do salão. Inteira é um botão: clicar entra nela (na
 * de voz, puxa a cadeira).
 */
export function MesaDoSalao({
  id,
  tipo,
  nome,
  sentados = [],
  naoLidas = 0,
  mencoes = 0,
  aberta,
  minha,
  onEntrar,
}: {
  /** Id da mesa: decide a mobília (tampo, torção e cadeiras) da mesa de voz. */
  id: string;
  tipo: "text" | "voice";
  nome: string;
  sentados?: Sentado[];
  naoLidas?: number;
  mencoes?: number;
  /** É a mesa que está aberta na tela. */
  aberta?: boolean;
  /** Estou sentado nela (só voz). */
  minha?: boolean;
  onEntrar: () => void;
}) {
  if (tipo === "text") {
    const situacao =
      mencoes > 0
        ? `@você · ${mencoes > 99 ? "99+" : mencoes}`
        : naoLidas > 0
          ? `${naoLidas > 99 ? "99+" : naoLidas} ${naoLidas === 1 ? "nova" : "novas"}`
          : "tudo lido";
    return (
      <button
        onClick={onEntrar}
        aria-label={`Mesa de texto ${nome}, ${situacao}`}
        className="group relative h-[150px] w-[190px] shrink-0 text-left"
      >
        <span
          className={cn(
            "tampo-de-madeira absolute inset-x-0 top-3 bottom-5 transition-transform group-hover:-translate-y-0.5",
            aberta && "outline-primary outline-[3px] outline-offset-2",
          )}
        />
        <span className="bg-papel text-papel-tinta border-papel-linha absolute top-6 left-5 flex w-[150px] -rotate-3 flex-col gap-1 border-t-[3px] border-dotted px-3 py-2 shadow-[0_6px_14px_rgb(0_0_0/0.45)] transition-transform group-hover:-rotate-1">
          <span className="font-display truncate text-xl leading-none tracking-wide">#{nome}</span>
          <span
            className={cn(
              "w-fit rounded-full px-1.5 text-[10px] font-bold",
              mencoes > 0
                ? "bg-destructive text-destructive-foreground"
                : naoLidas > 0
                  ? "bg-primary text-primary-foreground"
                  : "text-papel-tinta/60",
            )}
          >
            {situacao}
          </span>
        </span>
        <span className="text-foreground/60 absolute inset-x-0 bottom-0 text-center text-[11px]">
          mesa de texto
        </span>
      </button>
    );
  }

  const mobilia = mobiliaDaMesa(id);
  // Vazia, a mesa mostra as cadeiras que tem, tortas junto com ela. Ocupada, cada
  // um puxou a sua: uma cadeira embaixo de cada tampinha.
  const vazia = sentados.length === 0;
  const lugares = vazia ? mobilia.cadeiras.length : Math.min(sentados.length, 10);

  return (
    <button
      onClick={onEntrar}
      aria-label={`Mesa de voz ${nome}, ${vazia ? "vazia" : `${sentados.length} sentados`}`}
      className="mesa-voz group relative size-[200px] shrink-0"
      style={{ "--giro": `${mobilia.giro}deg` } as CSSProperties}
    >
      <span aria-hidden className="mesa-luz" />
      <span
        aria-hidden
        className={cn("mesa-sombra", mobilia.tampo !== "formica-redonda" && "mesa-sombra-quadrada")}
      />
      {Array.from({ length: lugares }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className={cn("cadeira", `cadeira-${mobilia.cadeiras[i % mobilia.cadeiras.length]}`)}
          style={
            {
              "--a": `${(i * 360) / lugares + (vazia ? mobilia.giro : 0)}deg`,
              "--r": vazia ? "76px" : "86px",
            } as CSSProperties
          }
        />
      ))}
      <span
        className={cn(
          "tampo-de-voz flex flex-col items-center justify-center gap-1 px-2 text-center",
          `tampo-${mobilia.tampo}`,
          (aberta || minha) && "tampo-minha",
        )}
      >
        {mobilia.tampo === "plastico" && <span className="furo-do-guarda-sol" />}
        <span className="font-display line-clamp-2 text-lg leading-none tracking-wide">{nome}</span>
        {vazia && <span className="text-papel-tinta/70 text-[10px]">puxe uma cadeira</span>}
      </span>
      {sentados.slice(0, 10).map((p, i) => {
        const pos = emVolta(i, Math.min(sentados.length, 10));
        return (
          <span
            key={p.id}
            title={p.nome}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_3px_6px_rgb(0_0_0/0.55)]"
            style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
          >
            <Bottlecap
              name={p.nome}
              src={p.avatar}
              speaking={p.falando}
              className="size-10 text-sm"
            />
          </span>
        );
      })}
      {sentados.length > 10 && (
        <span className="bg-background/90 absolute right-1 bottom-1 rounded-full px-1.5 text-[11px] font-semibold">
          +{sentados.length - 10}
        </span>
      )}
    </button>
  );
}
