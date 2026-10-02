import { describe, expect, it } from "vitest";
import {
  depoisDe,
  formatDay,
  isGrouped,
  mencaoEmAndamento,
  menciona,
  resumoDeReacoes,
  rotuloDoDia,
  textoDigitando,
  trechos,
  type Message,
} from "@/lib/chat";

const usernames = { a: "joao", b: "joao.silva", c: "ana_b" };

/** Texto com as menções trocadas por [id], para comparar de olho. */
const marcar = (texto: string) =>
  trechos(texto, usernames)
    .map((t) => (t.tipo === "mencao" ? `[${t.userId}]` : t.texto))
    .join("");

const msg = (over: Partial<Message> = {}): Message => ({
  id: "1",
  channel_id: "mesa",
  user_id: "a",
  content: "",
  created_at: "2026-10-01T10:00:00Z",
  edited_at: null,
  reply_to: null,
  image_path: null,
  ...over,
});

describe("menções", () => {
  it("acha @username com pontuação em volta", () => {
    expect(marcar("oi @joao, tudo?")).toBe("oi [a], tudo?");
    expect(marcar("@joao.")).toBe("[a].");
  });

  it("prefere o username mais longo (joao.silva não vira joao + .silva)", () => {
    expect(marcar("@joao.silva chegou")).toBe("[b] chegou");
  });

  it("ignora maiúsculas", () => {
    expect(marcar("@JOAO e @Ana_B!")).toBe("[a] e [c]!");
  });

  it("não vê menção em e-mail nem em nome que só começa igual", () => {
    expect(marcar("email joao@joao.com")).toBe("email joao@joao.com");
    expect(marcar("@joaozinho")).toBe("@joaozinho");
    expect(marcar("@ana_bx")).toBe("@ana_bx");
  });

  it("menciona confere a pessoa certa", () => {
    expect(menciona("fala @ana_b", "c", usernames)).toBe(true);
    expect(menciona("fala @ana_bc", "c", usernames)).toBe(false);
  });

  it("autocompletar só abre com @ no começo ou depois de espaço", () => {
    expect(mencaoEmAndamento("oi @jo", 6)).toEqual({ inicio: 3, termo: "jo" });
    expect(mencaoEmAndamento("@", 1)).toEqual({ inicio: 0, termo: "" });
    expect(mencaoEmAndamento("oi@jo", 5)).toBeNull();
    expect(mencaoEmAndamento("oi @jo ", 7)).toBeNull();
  });
});

describe("agrupamento e dias", () => {
  it("junta mensagens da mesma pessoa dentro de 5 minutos", () => {
    const a = msg();
    expect(isGrouped(a, msg({ id: "2", created_at: "2026-10-01T10:04:00Z" }))).toBe(true);
    expect(isGrouped(a, msg({ id: "2", created_at: "2026-10-01T10:06:00Z" }))).toBe(false);
    expect(isGrouped(a, msg({ id: "2", user_id: "b", created_at: "2026-10-01T10:01:00Z" }))).toBe(
      false,
    );
  });

  it("resposta sempre abre bloco novo, para a citação ter cabeçalho", () => {
    const resposta = msg({ id: "2", reply_to: "1", created_at: "2026-10-01T10:01:00Z" });
    expect(isGrouped(msg(), resposta)).toBe(false);
  });

  it("rotula hoje, ontem e o resto por extenso", () => {
    const agora = new Date("2026-10-01T15:00:00");
    expect(rotuloDoDia("2026-10-01T09:00:00", agora)).toBe("Hoje");
    expect(rotuloDoDia("2026-09-30T09:00:00", agora)).toBe("Ontem");
    expect(rotuloDoDia("2026-09-29T09:00:00", agora)).toBe("terça-feira, 29 de setembro");
    expect(rotuloDoDia("2025-12-25T09:00:00", agora)).toContain("2025");
    expect(formatDay("2026-09-30T09:00:00", agora)).toBe("ontem");
  });

  it("linha de novas compara instantes, não o texto das datas", () => {
    // O banco manda "+00:00" com microssegundos; o navegador, "Z" com milissegundos.
    const limiar = "2026-10-01T10:00:00.500Z";
    const depois = msg({ user_id: "b", created_at: "2026-10-01T10:00:00.9+00:00" });
    const antes = msg({ user_id: "b", created_at: "2026-10-01T10:00:00.1+00:00" });
    expect(depoisDe(depois, limiar, "a")).toBe(true);
    expect(depoisDe(antes, limiar, "a")).toBe(false);
    // As minhas nunca ficam abaixo da linha.
    expect(depoisDe(msg({ created_at: "2026-10-01T11:00:00Z" }), limiar, "a")).toBe(false);
  });
});

describe("reações e digitando", () => {
  it("agrupa reações por emoji na ordem em que apareceram", () => {
    expect(
      resumoDeReacoes([
        { message_id: "1", user_id: "a", emoji: "🍺" },
        { message_id: "1", user_id: "b", emoji: "🔥" },
        { message_id: "1", user_id: "c", emoji: "🍺" },
      ]),
    ).toEqual([
      { emoji: "🍺", userIds: ["a", "c"] },
      { emoji: "🔥", userIds: ["b"] },
    ]);
  });

  it("escreve o digitando conforme a quantidade de gente", () => {
    expect(textoDigitando([])).toBe("");
    expect(textoDigitando(["Ana"])).toBe("Ana está digitando…");
    expect(textoDigitando(["Ana", "Beto"])).toBe("Ana e Beto estão digitando…");
    expect(textoDigitando(["A", "B", "C", "D"])).toBe("Várias pessoas estão digitando…");
  });
});
