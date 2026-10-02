import type { ReactNode } from "react";
import { Users } from "lucide-react";

/**
 * A coluna da direita: em cima as transmissões (só quando tem alguém
 * transmitindo), embaixo quem tá no bar.
 *
 * A lista de participantes se esconde com um clique — aí, sem transmissão, a
 * coluna vira uma faixa fina com o botão de mostrar de volta, e o chat ganha a
 * largura. No celular ela é uma gaveta e mostra sempre as duas partes.
 */
export function ColunaDireita({
  telas,
  participantes,
  mostrarParticipantes,
  onMostrarParticipantes,
}: {
  /** As transmissões, ou null quando ninguém está transmitindo. */
  telas: ReactNode | null;
  participantes: ReactNode;
  mostrarParticipantes: boolean;
  onMostrarParticipantes: () => void;
}) {
  if (!telas && !mostrarParticipantes) {
    return (
      <aside className="border-border bg-rail flex h-full w-11 shrink-0 flex-col items-center border-l py-3">
        <button
          type="button"
          onClick={onMostrarParticipantes}
          title="Mostrar quem tá no bar"
          aria-label="Mostrar quem tá no bar"
          className="text-muted-foreground hover:text-foreground hover:bg-surface-2 rounded-lg p-2"
        >
          <Users className="size-5" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="border-border bg-rail flex h-full w-72 shrink-0 flex-col border-l">
      {telas && (
        <div
          className={
            mostrarParticipantes
              ? "border-border flex max-h-[55%] min-h-0 shrink-0 flex-col border-b"
              : "flex min-h-0 flex-1 flex-col"
          }
        >
          {telas}
        </div>
      )}
      {mostrarParticipantes ? (
        participantes
      ) : (
        <button
          type="button"
          onClick={onMostrarParticipantes}
          className="border-border text-muted-foreground hover:text-foreground hover:bg-surface-2 flex shrink-0 items-center justify-center gap-2 border-t py-2.5 text-sm transition-colors"
        >
          <Users className="size-4" /> Mostrar quem tá no bar
        </button>
      )}
    </aside>
  );
}
