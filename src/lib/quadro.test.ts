import { describe, expect, it } from "vitest";
import { QUADRO_VAZIO, quadroEmBranco, regrasDoTexto } from "./quadro";

describe("regrasDoTexto", () => {
  it("vira uma regra por linha, sem linhas vazias", () => {
    expect(regrasDoTexto("Sem spam\n\n  Respeita a galera  \r\n")).toEqual([
      "Sem spam",
      "Respeita a galera",
    ]);
  });

  it("tira a numeração e os marcadores que a pessoa já escreveu", () => {
    expect(regrasDoTexto("1. Um\n2) Dois\n- Três\n* Quatro\n• Cinco\n10º Dez")).toEqual([
      "Um",
      "Dois",
      "Três",
      "Quatro",
      "Cinco",
      "Dez",
    ]);
  });

  it("não come número que faz parte da regra", () => {
    expect(regrasDoTexto("18 anos ou mais")).toEqual(["18 anos ou mais"]);
  });
});

describe("quadroEmBranco", () => {
  it("vazio e só espaços contam como em branco", () => {
    expect(quadroEmBranco(QUADRO_VAZIO)).toBe(true);
    expect(quadroEmBranco({ boas_vindas: "  ", regras: "\n- \n", aviso: "" })).toBe(true);
  });

  it("qualquer parte preenchida já é quadro", () => {
    expect(quadroEmBranco({ ...QUADRO_VAZIO, aviso: "Hoje tem jogo" })).toBe(false);
  });
});
