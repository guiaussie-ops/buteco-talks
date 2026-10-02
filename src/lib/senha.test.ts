import { describe, expect, it } from "vitest";
import { mensagemDeErroDaSenha, problemaDaSenha } from "@/lib/senha";

describe("problemaDaSenha", () => {
  it("aceita 8 ou mais, com letra e número", () => {
    expect(problemaDaSenha("cerveja1")).toBeNull();
    expect(problemaDaSenha("Ça1234567")).toBeNull();
  });

  it("recusa curta, sem letra ou sem número, dizendo o que falta", () => {
    expect(problemaDaSenha("abc123")).toMatch(/8 caracteres/);
    expect(problemaDaSenha("12345678")).toMatch(/letra/);
    expect(problemaDaSenha("cervejaa")).toMatch(/número/);
  });
});

describe("mensagemDeErroDaSenha", () => {
  it("traduz a recusa de senha fraca do Supabase", () => {
    expect(mensagemDeErroDaSenha("Password should be at least 8 characters.")).toMatch(
      /^Senha fraca/,
    );
    expect(
      mensagemDeErroDaSenha("Password should contain at least one character of each: abc, 123"),
    ).toMatch(/^Senha fraca/);
  });

  it("deixa os outros erros como estão", () => {
    expect(mensagemDeErroDaSenha("User already registered")).toBe("User already registered");
  });
});
