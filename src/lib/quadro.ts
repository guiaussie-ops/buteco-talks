/**
 * O quadro pendurado no salão. O banco guarda texto corrido (salvar_quadro);
 * aqui fica só o jeito de mostrar e os limites, iguais aos CHECK da tabela.
 */

export type Quadro = { boas_vindas: string; regras: string; aviso: string };

export const QUADRO_VAZIO: Quadro = { boas_vindas: "", regras: "", aviso: "" };

export const LIMITE: Record<keyof Quadro, number> = {
  boas_vindas: 600,
  regras: 2000,
  aviso: 300,
};

/**
 * Uma regra por linha. Quem escreve costuma numerar ou pôr tracinho por conta
 * própria; o quadro numera sozinho, então isso sai para não ficar "1. 1. ...".
 */
export function regrasDoTexto(texto: string): string[] {
  return texto
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+\s*[.)º°-])\s*/, "").trim())
    .filter(Boolean);
}

export function quadroEmBranco(q: Quadro) {
  return !q.boas_vindas.trim() && !q.aviso.trim() && regrasDoTexto(q.regras).length === 0;
}
