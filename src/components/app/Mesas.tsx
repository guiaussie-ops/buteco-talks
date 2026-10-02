import { cn } from "@/lib/utils";
import { corDaTampinha } from "@/lib/tampinha";

/**
 * As mesas do buteco desenhadas como mesas. É a peça que tira a cara de lista
 * de canais: a de texto é quadrada com a comanda de papel em cima, a de voz é
 * redonda com as tampinhas de quem está sentado em volta.
 *
 * Duas escalas do mesmo desenho: a miniatura da barra lateral e a mesa grande
 * da planta do salão.
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
