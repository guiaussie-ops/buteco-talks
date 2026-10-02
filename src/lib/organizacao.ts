/**
 * Arrumação das mesas em categorias. Tudo aqui é puro: recebe a arrumação
 * atual e devolve a nova, que o `organizar_mesas` grava de uma vez.
 */

export type Categoria = { id: string; name: string; position: number };
export type MesaArrumavel = {
  id: string;
  category_id: string | null;
  position: number;
};

/** Um bloco da barra lateral: as mesas sem categoria (id null) ou uma categoria. */
export type Bloco<M> = { categoria: Categoria | null; mesas: M[] };

const porPosicao = <T extends { position: number }>(a: T, b: T) => a.position - b.position;

/**
 * Monta a barra lateral: primeiro as mesas soltas, depois cada categoria na
 * ordem dela. Mesa que aponta para categoria inexistente cai nas soltas.
 */
export function montarBlocos<M extends MesaArrumavel>(
  categorias: Categoria[],
  mesas: M[],
): Bloco<M>[] {
  const ids = new Set(categorias.map((c) => c.id));
  const ordenadas = [...mesas].sort(porPosicao);
  const soltas = ordenadas.filter((m) => !m.category_id || !ids.has(m.category_id));
  return [
    { categoria: null, mesas: soltas },
    ...[...categorias].sort(porPosicao).map((categoria) => ({
      categoria,
      mesas: ordenadas.filter((m) => m.category_id === categoria.id),
    })),
  ];
}

export type Arrumacao = {
  categorias: string[];
  mesas: { id: string; category_id: string | null }[];
};

/** Achata os blocos na forma que o banco grava: a posição é a ordem na lista. */
export function arrumacaoDe<M extends MesaArrumavel>(blocos: Bloco<M>[]): Arrumacao {
  return {
    categorias: blocos.flatMap((b) => (b.categoria ? [b.categoria.id] : [])),
    mesas: blocos.flatMap((b) =>
      b.mesas.map((m) => ({ id: m.id, category_id: b.categoria?.id ?? null })),
    ),
  };
}

/**
 * Onde a mesa arrastada vai parar:
 * - `antesDe`: no lugar da mesa alvo, empurrando ela para baixo;
 * - `fimDe`: no fim da categoria (null = mesas soltas).
 */
export type DestinoDaMesa = { antesDe: string } | { fimDe: string | null };

export function moverMesa<M extends MesaArrumavel>(
  blocos: Bloco<M>[],
  mesaId: string,
  destino: DestinoDaMesa,
) {
  const mesa = blocos.flatMap((b) => b.mesas).find((m) => m.id === mesaId);
  if (!mesa || ("antesDe" in destino && destino.antesDe === mesaId)) return blocos;
  const semEla = blocos.map((b) => ({ ...b, mesas: b.mesas.filter((m) => m.id !== mesaId) }));
  return semEla.map((b) => {
    if ("antesDe" in destino) {
      const i = b.mesas.findIndex((m) => m.id === destino.antesDe);
      if (i < 0) return b;
      return { ...b, mesas: [...b.mesas.slice(0, i), mesa, ...b.mesas.slice(i)] };
    }
    if ((b.categoria?.id ?? null) !== destino.fimDe) return b;
    return { ...b, mesas: [...b.mesas, mesa] };
  });
}

/** Sobe (-1) ou desce (+1) a mesa dentro do bloco dela. */
export function deslocarMesa<M extends MesaArrumavel>(
  blocos: Bloco<M>[],
  mesaId: string,
  passo: -1 | 1,
) {
  return blocos.map((b) => {
    const i = b.mesas.findIndex((m) => m.id === mesaId);
    const j = i + passo;
    if (i < 0 || j < 0 || j >= b.mesas.length) return b;
    const mesas = [...b.mesas];
    [mesas[i], mesas[j]] = [mesas[j]!, mesas[i]!];
    return { ...b, mesas };
  });
}

/** Põe a categoria arrastada no lugar de outra. As mesas soltas ficam sempre em cima. */
export function moverCategoria<M extends MesaArrumavel>(
  blocos: Bloco<M>[],
  categoriaId: string,
  antesDe: string | null,
) {
  const [soltas, ...resto] = blocos;
  const bloco = resto.find((b) => b.categoria?.id === categoriaId);
  if (!bloco || !soltas || antesDe === categoriaId) return blocos;
  const semEle = resto.filter((b) => b !== bloco);
  const i = antesDe === null ? semEle.length : semEle.findIndex((b) => b.categoria?.id === antesDe);
  if (i < 0) return blocos;
  return [soltas, ...semEle.slice(0, i), bloco, ...semEle.slice(i)];
}

export function deslocarCategoria<M extends MesaArrumavel>(
  blocos: Bloco<M>[],
  categoriaId: string,
  passo: -1 | 1,
) {
  const [soltas, ...resto] = blocos;
  const i = resto.findIndex((b) => b.categoria?.id === categoriaId);
  const j = i + passo;
  if (!soltas || i < 0 || j < 0 || j >= resto.length) return blocos;
  const novo = [...resto];
  [novo[i], novo[j]] = [novo[j]!, novo[i]!];
  return [soltas, ...novo];
}
