/**
 * A mobília das mesas de voz do salão. Buteco é acúmulo: a mesa de fórmica está
 * lá há trinta anos, a de plástico a cervejaria deu ano passado, e nada combina.
 *
 * Cada mesa tira o tipo de tampo, a torção e as cadeiras do próprio id: é sempre
 * a mesma mesa para todo mundo, em toda visita, e mesa nova entra na mistura
 * sozinha.
 */

export type Tampo = "plastico" | "formica-redonda" | "formica-quadrada";
export type Cadeira = "plastico" | "plastico-branca" | "ferro" | "banqueta";

export type Mobilia = {
  tampo: Tampo;
  /** Quanto a mesa está torta, em graus. A redonda não tem como ficar torta. */
  giro: number;
  /** As cadeiras que a mesa tem quando está vazia, em volta, começando por cima. */
  cadeiras: Cadeira[];
};

/** FNV-1a: espalha bem ids parecidos (uuids que só mudam no fim). */
function semente(id: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: uma sequência de números em [0, 1) que sai sempre igual da mesma semente. */
function sorteio(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mobiliaDaMesa(id: string): Mobilia {
  const r = sorteio(semente(id));
  const x = r();

  if (x < 0.45) {
    // Kit da cervejaria: quatro cadeiras amarelas, uma ou outra branca de outro kit,
    // e às vezes uma de ferro que alguém puxou da mesa do lado.
    const cadeiras = Array.from({ length: 4 }, (): Cadeira => {
      const y = r();
      return y < 0.72 ? "plastico" : y < 0.92 ? "plastico-branca" : "ferro";
    });
    return { tampo: "plastico", giro: Math.round(r() * 14 - 7), cadeiras };
  }

  const ferroOuBanqueta = (): Cadeira => (r() < 0.7 ? "ferro" : "banqueta");
  if (x < 0.75) {
    return {
      tampo: "formica-redonda",
      giro: 0,
      cadeiras: Array.from({ length: 5 }, ferroOuBanqueta),
    };
  }
  return {
    tampo: "formica-quadrada",
    giro: Math.round(r() * 4 - 2),
    cadeiras: Array.from({ length: 4 }, ferroOuBanqueta),
  };
}
