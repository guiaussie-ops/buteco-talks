import { describe, expect, it } from "vitest";
import {
  arrumacaoDe,
  deslocarCategoria,
  deslocarMesa,
  montarBlocos,
  moverCategoria,
  moverMesa,
  type Bloco,
  type MesaArrumavel,
} from "@/lib/organizacao";

const categorias = [
  { id: "T", name: "Texto", position: 0 },
  { id: "V", name: "Voz", position: 1 },
];
const mesa = (id: string, category_id: string | null, position: number) => ({
  id,
  category_id,
  position,
});
const mesas = [
  mesa("memes", "T", 1),
  mesa("geral", "T", 0),
  mesa("sala", "V", 2),
  mesa("solta", null, 3),
  mesa("orfa", "sumiu", 4),
];

/** "-:[solta] T:[geral,memes] V:[sala]" — a barra lateral em uma linha. */
const desenho = (blocos: Bloco<MesaArrumavel>[]) =>
  blocos.map((b) => `${b.categoria?.id ?? "-"}:[${b.mesas.map((m) => m.id).join(",")}]`).join(" ");

const blocos = montarBlocos(categorias, mesas);

describe("montarBlocos", () => {
  it("soltas primeiro, depois cada categoria em ordem de posição", () => {
    expect(desenho(blocos)).toBe("-:[solta,orfa] T:[geral,memes] V:[sala]");
  });

  it("mesa de categoria que não existe mais cai nas soltas", () => {
    expect(blocos[0]!.mesas.map((m) => m.id)).toContain("orfa");
  });
});

describe("mover mesas", () => {
  it("antes de outra mesa, adotando a categoria dela", () => {
    expect(desenho(moverMesa(blocos, "sala", { antesDe: "memes" }))).toBe(
      "-:[solta,orfa] T:[geral,sala,memes] V:[]",
    );
  });

  it("para o fim de uma categoria ou das soltas", () => {
    expect(desenho(moverMesa(blocos, "geral", { fimDe: "V" }))).toBe(
      "-:[solta,orfa] T:[memes] V:[sala,geral]",
    );
    expect(desenho(moverMesa(blocos, "memes", { fimDe: null }))).toBe(
      "-:[solta,orfa,memes] T:[geral] V:[sala]",
    );
  });

  it("soltar em cima de si mesma não muda nada (e nem grava)", () => {
    expect(moverMesa(blocos, "geral", { antesDe: "geral" })).toBe(blocos);
  });

  it("sobe e desce dentro do bloco, parando nas pontas", () => {
    expect(desenho(deslocarMesa(blocos, "geral", 1))).toBe(
      "-:[solta,orfa] T:[memes,geral] V:[sala]",
    );
    expect(desenho(deslocarMesa(blocos, "geral", -1))).toBe(desenho(blocos));
  });
});

describe("mover categorias", () => {
  it("antes de outra, ou para o fim", () => {
    const esperado = "-:[solta,orfa] V:[sala] T:[geral,memes]";
    expect(desenho(moverCategoria(blocos, "V", "T"))).toBe(esperado);
    expect(desenho(moverCategoria(blocos, "T", null))).toBe(esperado);
  });

  it("as soltas ficam sempre em cima", () => {
    expect(moverCategoria(blocos, "V", "T")[0]!.categoria).toBeNull();
  });

  it("subir a primeira não muda nada", () => {
    expect(deslocarCategoria(blocos, "T", -1)).toBe(blocos);
    expect(desenho(deslocarCategoria(blocos, "V", -1))).toBe(
      "-:[solta,orfa] V:[sala] T:[geral,memes]",
    );
  });
});

describe("arrumacaoDe", () => {
  it("achata na ordem da tela e conserta a categoria das órfãs", () => {
    expect(arrumacaoDe(moverMesa(blocos, "sala", { antesDe: "memes" }))).toEqual({
      categorias: ["T", "V"],
      mesas: [
        { id: "solta", category_id: null },
        { id: "orfa", category_id: null },
        { id: "geral", category_id: "T" },
        { id: "sala", category_id: "T" },
        { id: "memes", category_id: "T" },
      ],
    });
  });
});
