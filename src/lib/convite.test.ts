import { describe, expect, it } from "vitest";
import {
  lerVitrine,
  limitesDoConvite,
  mesasPorCategoria,
  passosDe,
  statusDaEntrada,
  type Vitrine,
} from "./convite";

const valido: Vitrine = { status: "valido", buteco: { nome: "Bar", emoji: "🍺" }, mesas: [] };

describe("lerVitrine", () => {
  it("resposta torta vira convite inválido", () => {
    expect(lerVitrine(null)).toEqual({ status: "invalido" });
    expect(lerVitrine({ status: "outra coisa" })).toEqual({ status: "invalido" });
  });

  it("resposta conhecida passa como veio", () => {
    expect(lerVitrine({ status: "esgotado" }).status).toBe("esgotado");
  });
});

describe("statusDaEntrada", () => {
  it("traduz o que o join_server_by_code responde", () => {
    expect(statusDaEntrada("joined")).toBe("entrou");
    expect(statusDaEntrada("already_member")).toBe("ja_e_membro");
    expect(statusDaEntrada("expired")).toBe("vencido");
    expect(statusDaEntrada("exhausted")).toBe("esgotado");
    expect(statusDaEntrada("banned")).toBe("banido");
    expect(statusDaEntrada("not_found")).toBe("invalido");
    expect(statusDaEntrada(undefined)).toBe("invalido");
  });
});

describe("passosDe", () => {
  it("pula as regras quando o quadro não tem nenhuma", () => {
    expect(passosDe(valido)).toEqual(["porta", "mesas"]);
    expect(
      passosDe({ ...valido, quadro: { boas_vindas: "Oi", regras: " \n- ", aviso: "" } }),
    ).toEqual(["porta", "mesas"]);
  });

  it("mostra as regras quando tem", () => {
    expect(
      passosDe({ ...valido, quadro: { boas_vindas: "", regras: "Sem spam", aviso: "" } }),
    ).toEqual(["porta", "regras", "mesas"]);
  });
});

describe("mesasPorCategoria", () => {
  it("agrupa as mesas seguidas da mesma categoria, mantendo a ordem", () => {
    const grupos = mesasPorCategoria([
      { nome: "solta", tipo: "text", categoria: null },
      { nome: "geral", tipo: "text", categoria: "Texto" },
      { nome: "memes", tipo: "text", categoria: "Texto" },
      { nome: "papo", tipo: "voice", categoria: "Voz" },
    ]);
    expect(grupos.map((g) => [g.categoria, g.mesas.map((m) => m.nome)])).toEqual([
      [null, ["solta"]],
      ["Texto", ["geral", "memes"]],
      ["Voz", ["papo"]],
    ]);
  });
});

describe("limitesDoConvite", () => {
  const agora = new Date(2026, 9, 20, 18, 0);

  it("convite sem limite não avisa nada", () => {
    expect(limitesDoConvite(valido, agora)).toEqual([]);
  });

  it("fala do prazo e das vagas que sobram", () => {
    const vence = new Date(2026, 9, 21, 21, 0).toISOString();
    expect(limitesDoConvite({ ...valido, vence_em: vence, usos_restantes: 1 }, agora)).toEqual([
      "vale até amanhã às 21:00",
      "só sobra 1 vaga",
    ]);
    expect(limitesDoConvite({ ...valido, usos_restantes: 4 }, agora)).toEqual(["sobram 4 vagas"]);
  });
});
