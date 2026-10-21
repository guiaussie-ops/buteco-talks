import { describe, expect, it } from "vitest";
import {
  DURA_MS,
  doCampoLocal,
  emPauta,
  horarioSugerido,
  paraCampoLocal,
  quandoE,
  quemVai,
} from "./encontros";

const agora = new Date(2026, 9, 21, 18, 0); // quarta, 21/10, 18h
const em = (d: Date) => ({ comeca_em: d.toISOString() });

describe("emPauta", () => {
  it("tira o que já acabou e ordena do mais perto ao mais longe", () => {
    const acabou = em(new Date(agora.getTime() - DURA_MS - 1));
    const rolando = em(new Date(agora.getTime() - 60_000));
    const depois = em(new Date(2026, 9, 25, 21, 0));
    const logo = em(new Date(2026, 9, 21, 21, 0));
    expect(emPauta([depois, acabou, logo, rolando], agora)).toEqual([rolando, logo, depois]);
  });
});

describe("quemVai", () => {
  it("só quem disse que vai", () => {
    expect(
      quemVai([
        { user_id: "a", vou: true },
        { user_id: "b", vou: false },
      ]),
    ).toEqual(["a"]);
  });
});

describe("quandoE", () => {
  it("já começou", () => {
    expect(quandoE(new Date(2026, 9, 21, 17, 30).toISOString(), agora)).toEqual({
      rotulo: "acontecendo agora",
      jaComecou: true,
      logo: false,
    });
  });

  it("na primeira hora conta os minutos", () => {
    expect(quandoE(new Date(2026, 9, 21, 18, 35).toISOString(), agora)).toEqual({
      rotulo: "começa em 35 min",
      jaComecou: false,
      logo: true,
    });
  });

  it("hoje, amanhã, dia da semana e data", () => {
    expect(quandoE(new Date(2026, 9, 21, 21, 0).toISOString(), agora).rotulo).toBe("hoje às 21:00");
    expect(quandoE(new Date(2026, 9, 22, 21, 0).toISOString(), agora).rotulo).toBe(
      "amanhã às 21:00",
    );
    expect(quandoE(new Date(2026, 9, 24, 21, 0).toISOString(), agora).rotulo).toBe("sáb às 21:00");
    expect(quandoE(new Date(2026, 10, 2, 9, 30).toISOString(), agora).rotulo).toBe(
      "02/11 às 09:30",
    );
  });
});

describe("campo de data", () => {
  it("vai e volta sem perder minuto", () => {
    const d = new Date(2026, 0, 5, 7, 9);
    expect(paraCampoLocal(d)).toBe("2026-01-05T07:09");
    expect(doCampoLocal("2026-01-05T07:09")?.getTime()).toBe(d.getTime());
  });

  it("vazio ou torto vira null", () => {
    expect(doCampoLocal("")).toBeNull();
    expect(doCampoLocal("amanhã")).toBeNull();
    expect(doCampoLocal("2026-02-31T10:00")).toBeNull();
  });
});

describe("horarioSugerido", () => {
  it("hoje às 21h, ou amanhã se já está tarde", () => {
    expect(horarioSugerido(agora)).toEqual(new Date(2026, 9, 21, 21, 0));
    expect(horarioSugerido(new Date(2026, 9, 21, 20, 30))).toEqual(new Date(2026, 9, 22, 21, 0));
  });
});
