import { useEffect, type ReactNode } from "react";
import { Menu, MonitorPlay } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/**
 * No computador, a coluna fica onde sempre esteve. No celular, vira uma gaveta
 * que desliza por cima do chat: aberta por um botão na barra de cima, fechada
 * tocando fora, com Esc ou escolhendo alguma coisa dentro.
 *
 * Fechada, fica `inert`: o Tab e o leitor de tela não entram numa coluna que
 * não está à vista.
 */
export function Gaveta({
  lado,
  aberta,
  onFechar,
  rotulo,
  children,
}: {
  lado: "esquerda" | "direita";
  aberta: boolean;
  onFechar: () => void;
  rotulo: string;
  children: ReactNode;
}) {
  const celular = useIsMobile();

  useEffect(() => {
    if (!celular || !aberta) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [celular, aberta, onFechar]);

  if (!celular) return <>{children}</>;

  return (
    <>
      {aberta && <div aria-hidden className="fixed inset-0 z-40 bg-black/60" onClick={onFechar} />}
      <div
        role="dialog"
        aria-modal={aberta}
        aria-label={rotulo}
        inert={!aberta}
        className={cn(
          "fixed inset-y-0 z-50 flex max-w-[88vw] shadow-2xl transition-transform duration-200 ease-out",
          lado === "esquerda" ? "left-0" : "right-0",
          aberta ? "translate-x-0" : lado === "esquerda" ? "-translate-x-full" : "translate-x-full",
        )}
      >
        {children}
      </div>
    </>
  );
}

/**
 * Barra de cima, só no celular: abre a gaveta das mesas à esquerda e, quando
 * tem alguém transmitindo, a das telas à direita.
 */
export function BarraDoCelular({
  titulo,
  temTelas,
  onAbrirMesas,
  onAbrirTelas,
}: {
  titulo: string;
  temTelas: boolean;
  onAbrirMesas: () => void;
  onAbrirTelas: () => void;
}) {
  return (
    <div className="border-border bg-rail flex h-12 shrink-0 items-center gap-2 border-b px-2">
      <button
        type="button"
        onClick={onAbrirMesas}
        aria-label="Abrir as mesas"
        className="hover:bg-surface-2 flex size-10 items-center justify-center rounded-lg"
      >
        <Menu className="size-5" />
      </button>
      <span className="neon-sign font-display min-w-0 flex-1 truncate text-xl tracking-wider">
        {titulo}
      </span>
      {temTelas && (
        <button
          type="button"
          onClick={onAbrirTelas}
          aria-label="Abrir as transmissões"
          className="text-neon hover:bg-surface-2 flex size-10 items-center justify-center rounded-lg"
        >
          <MonitorPlay className="size-5" />
        </button>
      )}
    </div>
  );
}
