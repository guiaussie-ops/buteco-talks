import { describe, expect, it } from "vitest";
import { descreverAcao, quandoFoi, tipoDaAcao, validadeEmTexto } from "./historico";

const acao = (a: string, detalhes: unknown = {}, alvo_nome: string | null = "Zé") => ({
  acao: a,
  detalhes,
  alvo_nome,
});

describe("descreverAcao", () => {
  it("cargo com os rótulos da tela", () => {
    expect(descreverAcao(acao("mudou_cargo", { de: "member", para: "admin" })).frase).toBe(
      "mudou Zé de Membro para Admin",
    );
  });

  it("banimento com e sem motivo", () => {
    expect(descreverAcao(acao("baniu", { motivo: "spam" }))).toEqual({
      frase: "baniu Zé",
      detalhe: "Motivo: spam",
    });
    expect(descreverAcao(acao("baniu"))).toEqual({ frase: "baniu Zé" });
  });

  it("alvo sem perfil não vira buraco na frase", () => {
    expect(descreverAcao(acao("expulsou", {}, null)).frase).toBe("expulsou alguém que saiu");
  });

  it("convite aparece só pelo final do código", () => {
    expect(
      descreverAcao(acao("criou_convite", { final: "a1b2", validade_min: 10080, max_usos: 10 })),
    ).toEqual({ frase: "criou o convite …a1b2", detalhe: "Vale 7 dias, 10 usos" });
    expect(
      descreverAcao(acao("criou_convite", { final: "a1b2", validade_min: null, max_usos: null }))
        .detalhe,
    ).toBe("Vale sem prazo, sem limite de usos");
    expect(descreverAcao(acao("entrou", { final: "ffff" })).frase).toBe(
      "entrou usando o convite …ffff",
    );
    expect(descreverAcao(acao("entrou", { link_fixo: true })).frase).toBe("entrou pelo link fixo");
  });

  it("buteco renomeado e placa trocada", () => {
    expect(
      descreverAcao(acao("editou_buteco", { nome_antes: "A", nome: "B", emoji: "🍺" })).frase,
    ).toBe('renomeou o buteco de "A" para "B"');
    expect(
      descreverAcao(acao("editou_buteco", { nome_antes: "A", nome: "A", emoji: "🍺" })).frase,
    ).toBe("trocou a placa da porta para 🍺");
  });

  it("mesas pelo tipo", () => {
    expect(descreverAcao(acao("criou_mesa", { nome: "papo", tipo: "voice" })).frase).toBe(
      'abriu a mesa de voz "papo"',
    );
    expect(descreverAcao(acao("renomeou_mesa", { de: "a", para: "b", tipo: "text" })).frase).toBe(
      'renomeou a mesa de texto "a" para "b"',
    );
  });

  it("ação desconhecida não quebra", () => {
    expect(descreverAcao(acao("algo_novo", null)).frase).toBe("algo novo");
  });
});

describe("tipoDaAcao", () => {
  it("separa membros, convites e o resto", () => {
    expect(tipoDaAcao("baniu")).toBe("membros");
    expect(tipoDaAcao("revogou_convite")).toBe("convites");
    expect(tipoDaAcao("criou_mesa")).toBe("buteco");
  });
});

describe("validadeEmTexto", () => {
  it("minutos, horas e dias", () => {
    expect(validadeEmTexto(30)).toBe("30 min");
    expect(validadeEmTexto(360)).toBe("6 h");
    expect(validadeEmTexto(1440)).toBe("1 dia");
  });
});

describe("quandoFoi", () => {
  const agora = new Date(2026, 9, 21, 15, 0);
  it("recente, hoje, ontem e antes", () => {
    expect(quandoFoi(new Date(2026, 9, 21, 14, 59, 40).toISOString(), agora)).toBe(
      "agora há pouco",
    );
    expect(quandoFoi(new Date(2026, 9, 21, 14, 50).toISOString(), agora)).toBe("há 10 min");
    expect(quandoFoi(new Date(2026, 9, 21, 12, 0).toISOString(), agora)).toBe("há 3 h");
    expect(quandoFoi(new Date(2026, 9, 20, 21, 4).toISOString(), agora)).toBe("ontem às 21:04");
    expect(quandoFoi(new Date(2026, 9, 12, 9, 30).toISOString(), agora)).toBe("12/10 às 09:30");
  });
});
