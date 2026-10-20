/**
 * A vitrine do convite (RPC ver_convite) e o passo a passo de quem chega.
 * O banco decide se a porta abre; aqui fica só o jeito de mostrar.
 */

import { QUADRO_VAZIO, regrasDoTexto, type Quadro } from "@/lib/quadro";

export type StatusDoConvite =
  "valido" | "vencido" | "esgotado" | "invalido" | "banido" | "ja_e_membro";

export type MesaDoConvite = { nome: string; tipo: "text" | "voice"; categoria: string | null };

export type Vitrine = {
  status: StatusDoConvite;
  server_id?: string;
  buteco?: { nome: string; emoji: string };
  membros?: number;
  vence_em?: string | null;
  usos_restantes?: number | null;
  quadro?: Quadro | null;
  mesas?: MesaDoConvite[];
};

const STATUS: StatusDoConvite[] = [
  "valido",
  "vencido",
  "esgotado",
  "invalido",
  "banido",
  "ja_e_membro",
];

/** O que vier torto do banco vira "invalido": melhor uma porta fechada que uma tela quebrada. */
export function lerVitrine(dado: unknown): Vitrine {
  const v = (dado ?? {}) as Partial<Vitrine>;
  return STATUS.includes(v.status as StatusDoConvite) ? (v as Vitrine) : { status: "invalido" };
}

/** O convite que não abre a porta diz por quê, e o que a pessoa pode fazer. */
export const PORTA_FECHADA: Record<
  Exclude<StatusDoConvite, "valido" | "ja_e_membro">,
  { titulo: string; texto: string }
> = {
  vencido: {
    titulo: "Esse convite venceu",
    texto: "Ele tinha prazo de validade, e o prazo passou. Peça um link novo pra quem te chamou.",
  },
  esgotado: {
    titulo: "Esse convite esgotou",
    texto:
      "Ele valia para um número certo de pessoas, e todas as vagas já foram usadas. Peça um link novo pra quem te chamou.",
  },
  invalido: {
    titulo: "Esse convite não existe",
    texto:
      "O link pode ter vindo cortado, digitado errado, ou o convite foi trocado ou cancelado. Confira o link ou peça um novo pra quem te chamou.",
  },
  banido: {
    titulo: "Porta fechada pra você",
    texto: "Você foi banido desse buteco, e convite nenhum abre essa porta.",
  },
};

/** join_server_by_code fala inglês; a tela fala a língua da vitrine. */
export function statusDaEntrada(status: string | undefined): StatusDoConvite | "entrou" {
  switch (status) {
    case "joined":
      return "entrou";
    case "already_member":
      return "ja_e_membro";
    case "expired":
      return "vencido";
    case "exhausted":
      return "esgotado";
    case "banned":
      return "banido";
    default:
      return "invalido";
  }
}

export type Passo = "porta" | "regras" | "mesas";

/** Sem regras escritas, o passo das regras some: não tem o que combinar. */
export function passosDe(v: Vitrine): Passo[] {
  return regrasDoTexto(v.quadro?.regras ?? "").length > 0
    ? ["porta", "regras", "mesas"]
    : ["porta", "mesas"];
}

export function quadroDe(v: Vitrine): Quadro {
  return { ...QUADRO_VAZIO, ...(v.quadro ?? {}) };
}

/** As mesas agrupadas pela categoria, na ordem em que o banco mandou. */
export function mesasPorCategoria(mesas: MesaDoConvite[]) {
  const grupos: { categoria: string | null; mesas: MesaDoConvite[] }[] = [];
  for (const m of mesas) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.categoria === m.categoria) ultimo.mesas.push(m);
    else grupos.push({ categoria: m.categoria, mesas: [m] });
  }
  return grupos;
}

/** "vale até amanhã às 21:00", "vale para mais 2 pessoas"; vazio quando não tem limite. */
export function limitesDoConvite(v: Vitrine, agora = new Date()): string[] {
  const avisos: string[] = [];
  if (v.vence_em) {
    const fim = new Date(v.vence_em);
    const hora = fim.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const dias = Math.round(
      (new Date(fim).setHours(0, 0, 0, 0) - new Date(agora).setHours(0, 0, 0, 0)) / 86_400_000,
    );
    const dia =
      dias === 0
        ? "hoje"
        : dias === 1
          ? "amanhã"
          : fim.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    avisos.push(`vale até ${dia} às ${hora}`);
  }
  if (typeof v.usos_restantes === "number") {
    avisos.push(v.usos_restantes === 1 ? "só sobra 1 vaga" : `sobram ${v.usos_restantes} vagas`);
  }
  return avisos;
}
