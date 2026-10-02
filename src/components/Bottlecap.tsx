import { cn } from "@/lib/utils";
import { corDaTampinha } from "@/lib/tampinha";

type Props = {
  name: string;
  className?: string;
  /** anel de neon pulsando (falando agora) */
  speaking?: boolean;
  /**
   * Foto do perfil; sem ela a tampinha gerada continua sendo o padrão.
   * O `undefined` é explícito por causa do exactOptionalPropertyTypes: quem
   * passa `avatars[id]` de um mapa incompleto manda undefined, não null.
   */
  src?: string | null | undefined;
};

/**
 * Avatar em formato de tampinha de cerveja: círculo serrilhado com a inicial.
 * Quem subiu foto aparece com ela, recortada dentro do mesmo serrilhado.
 */
export function Bottlecap({ name, className, speaking, src }: Props) {
  const { cap, capDark } = corDaTampinha(name);
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
      {src ? (
        <img
          src={src}
          alt=""
          className="absolute inset-[13%] rounded-full object-cover"
          loading="lazy"
        />
      ) : (
        <>
          <span
            className="absolute inset-[13%] rounded-full"
            style={{
              background: `radial-gradient(circle at 32% 26%, color-mix(in oklab, ${cap} 88%, white), ${capDark})`,
            }}
          />
          <span className="text-background font-display relative text-[0.95em] leading-none tracking-wide">
            {initial}
          </span>
        </>
      )}
    </span>
  );
}
