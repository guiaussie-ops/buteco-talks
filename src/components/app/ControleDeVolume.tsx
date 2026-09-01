import type { ReactNode } from "react";
import { VolumeX } from "lucide-react";
import { useVoice } from "@/lib/voice";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

/** Volume individual de um participante, em 0 a 100. */
export function useVolumeDoParticipante(userId: string) {
  const voice = useVoice();
  const percent = Math.round((voice.peerVolumes[userId] ?? 1) * 100);
  return {
    percent,
    definir: (p: number) => voice.setPeerVolume(userId, p / 100),
  };
}

/** Marca discreta de "esta pessoa está muda pra mim". */
export function SeloDeMudo({ className }: { className?: string }) {
  return <VolumeX className={cn("text-muted-foreground/70 shrink-0", className)} />;
}

/**
 * Volume de uma pessoa só, para quem está ouvindo — não mexe no que ela envia.
 *
 * Envolve o que for passado como filho e abre no clique, nunca no hover: no
 * celular não existe hover. Vive nos dois lugares em que a tampinha aparece,
 * a barra lateral e o painel da mesa.
 */
export function ControleDeVolume({
  userId,
  name,
  className,
  align = "center",
  children,
}: {
  userId: string;
  name: string;
  className?: string;
  align?: "start" | "center" | "end";
  children: ReactNode;
}) {
  const { percent, definir } = useVolumeDoParticipante(userId);

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
          className,
        )}
        aria-label={`Volume de ${name}: ${percent}%`}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-56 space-y-2 p-3">
        <p className="truncate text-sm font-medium">{name}</p>
        <Slider
          min={0}
          max={100}
          step={5}
          value={[percent]}
          onValueChange={([v]) => definir(v ?? 100)}
          aria-label={`Volume de ${name}`}
        />
        <p className="text-muted-foreground text-xs">
          {percent === 0 ? "Mudo pra você" : `${percent}% — só pra você.`}
        </p>
      </PopoverContent>
    </Popover>
  );
}
