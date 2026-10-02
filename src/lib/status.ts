/**
 * Status de MSN no buteco. "Invisível" é o "aparecer offline": a pessoa usa o
 * app normalmente, mas não entra na presença do bar e ninguém recebe o aviso
 * de que ela chegou.
 */
export const STATUS = {
  tomando_uma: { rotulo: "Tomando uma", cor: "bg-primary" },
  ocupado: { rotulo: "Ocupado", cor: "bg-neon" },
  saiu_pra_fumar: { rotulo: "Saiu pra fumar", cor: "bg-muted-foreground" },
  invisivel: { rotulo: "Invisível", cor: "bg-transparent ring-1 ring-muted-foreground" },
} as const;

export type Status = keyof typeof STATUS;

export const ORDEM_DOS_STATUS: Status[] = ["tomando_uma", "ocupado", "saiu_pra_fumar", "invisivel"];

export function statusDe(valor: string | null | undefined): Status {
  return valor && valor in STATUS ? (valor as Status) : "tomando_uma";
}
