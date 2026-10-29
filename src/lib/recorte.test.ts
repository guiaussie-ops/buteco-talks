import { describe, expect, it } from "vitest";
import { FOTO_LADO, ladoDaSaida, problemaNaFoto, tamanhoGirado } from "@/lib/recorte";

describe("problemaNaFoto", () => {
  it("aceita os quatro tipos de imagem até 8 MB", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/gif"]) {
      expect(problemaNaFoto({ type, size: 8 * 1024 * 1024 })).toBeNull();
    }
  });

  it("recusa outro tipo de arquivo", () => {
    expect(problemaNaFoto({ type: "image/heic", size: 1000 })).toMatch(/JPG, PNG, WEBP ou GIF/);
    expect(problemaNaFoto({ type: "application/pdf", size: 1000 })).toMatch(/JPG/);
  });

  it("recusa acima de 8 MB", () => {
    expect(problemaNaFoto({ type: "image/png", size: 8 * 1024 * 1024 + 1 })).toMatch(/8 MB/);
  });
});

describe("tamanhoGirado", () => {
  it("90° e 270° trocam largura e altura", () => {
    expect(tamanhoGirado(800, 600, 90)).toEqual({ largura: 600, altura: 800 });
    expect(tamanhoGirado(800, 600, 270)).toEqual({ largura: 600, altura: 800 });
  });

  it("0° e 180° mantêm", () => {
    expect(tamanhoGirado(800, 600, 0)).toEqual({ largura: 800, altura: 600 });
    expect(tamanhoGirado(800, 600, 180)).toEqual({ largura: 800, altura: 600 });
  });
});

describe("ladoDaSaida", () => {
  it("não passa de 512", () => {
    expect(ladoDaSaida({ x: 0, y: 0, width: 3000, height: 3000 })).toBe(FOTO_LADO);
  });

  it("não amplia recorte pequeno", () => {
    expect(ladoDaSaida({ x: 10, y: 10, width: 200.4, height: 200.4 })).toBe(200);
  });
});
