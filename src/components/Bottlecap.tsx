import { cn } from "@/lib/utils";

/** Cor determinística por apelido — cada pessoa tem sua tampinha. */
function hueFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

type Props = {
  name: string;
  className?: string;
  /** anel de neon pulsando (falando agora) */
  speaking?: boolean;
};

/**
 * Avatar em formato de tampinha de cerveja: círculo serrilhado com a inicial.
 */
export function Bottlecap({ name, className, speaking }: Props) {
  const hue = hueFor(name || "?");
  const cap = `oklch(0.66 0.14 ${hue})`;
  const capDark = `oklch(0.46 0.12 ${hue})`;
  const initial = (name || "?").trim().slice(0, 1).toUpperCase();

  return (
    <span
      className={cn(
        "relative inline-flex size-9 shrink-0 items-center justify-center rounded-full",
        speaking && "speaking-pulse",
        className,
      )}
      style={{
        background: `repeating-conic-gradient(${cap} 0deg 9deg, ${capDark} 9deg 18deg)`,
      }}
      aria-hidden
    >
      <span
        className="absolute inset-[13%] rounded-full"
        style={{
          background: `radial-gradient(circle at 32% 26%, color-mix(in oklab, ${cap} 88%, white), ${capDark})`,
        }}
      />
      <span className="text-background relative font-display text-[0.95em] leading-none tracking-wide">
        {initial}
      </span>
    </span>
  );
}
