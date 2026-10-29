/**
 * O recorte da foto do perfil: validar o que a pessoa escolheu e transformar
 * a área marcada no editor numa imagem quadrada de verdade, já pequena, antes
 * de subir para o bucket.
 */

export const FOTO_TIPOS = ["image/jpeg", "image/png", "image/webp", "image/gif"];
/** O que entra no editor. O que sobe é bem menor: no máximo FOTO_LADO × FOTO_LADO. */
export const FOTO_MAX_BYTES = 8 * 1024 * 1024;
/** Ninguém vê avatar maior que isso; o perfil mostra a tampinha a 128 px. */
export const FOTO_LADO = 512;
const QUALIDADE = 0.85;

export type Area = { x: number; y: number; width: number; height: number };

/** A mensagem de erro para um arquivo que não pode virar foto, ou null se pode. */
export function problemaNaFoto(arquivo: { type: string; size: number }) {
  if (!FOTO_TIPOS.includes(arquivo.type)) return "Manda uma imagem JPG, PNG, WEBP ou GIF.";
  if (arquivo.size > FOTO_MAX_BYTES) return "A imagem passou de 8 MB. Escolhe uma menor.";
  return null;
}

/** Largura e altura da caixa que cabe a imagem girada de `graus`. */
export function tamanhoGirado(largura: number, altura: number, graus: number) {
  const rad = (graus * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return {
    largura: Math.round(largura * cos + altura * sin),
    altura: Math.round(largura * sin + altura * cos),
  };
}

/** O lado da foto final: o do recorte, sem passar de FOTO_LADO nem ampliar. */
export function ladoDaSaida(area: Area) {
  return Math.max(1, Math.min(FOTO_LADO, Math.round(Math.min(area.width, area.height))));
}

function carregar(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Não consegui ler a imagem."));
    img.src = src;
  });
}

function paraBlob(canvas: HTMLCanvasElement, tipo: string) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, tipo, QUALIDADE));
}

/**
 * Recorta `area` da imagem girada e devolve um quadrado de até FOTO_LADO.
 *
 * `area` vem do react-easy-crop em pixels da imagem já girada, então primeiro
 * a imagem inteira é desenhada girada numa tela do tamanho da caixa que a
 * cabe, e o recorte sai dessa tela.
 *
 * WebP quando o navegador sabe gerar; senão JPEG. Quem não sabe gerar WebP
 * devolve PNG em silêncio, por isso o tipo do blob é conferido. GIF animado
 * vira uma foto parada: o canvas só enxerga o primeiro quadro.
 */
export async function recortarFoto(src: string, area: Area, graus: number) {
  const img = await carregar(src);
  const caixa = tamanhoGirado(img.naturalWidth, img.naturalHeight, graus);

  const girada = document.createElement("canvas");
  girada.width = caixa.largura;
  girada.height = caixa.altura;
  const g = girada.getContext("2d");
  if (!g) throw new Error("Sem canvas neste navegador.");
  g.translate(caixa.largura / 2, caixa.altura / 2);
  g.rotate((graus * Math.PI) / 180);
  g.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

  const lado = ladoDaSaida(area);
  const saida = document.createElement("canvas");
  saida.width = lado;
  saida.height = lado;
  const s = saida.getContext("2d");
  if (!s) throw new Error("Sem canvas neste navegador.");
  s.imageSmoothingQuality = "high";
  s.drawImage(girada, area.x, area.y, area.width, area.height, 0, 0, lado, lado);

  const webp = await paraBlob(saida, "image/webp");
  if (webp?.type === "image/webp") return webp;

  // JPEG não tem transparência: o fundo de um PNG vazado viria preto.
  const opaca = document.createElement("canvas");
  opaca.width = lado;
  opaca.height = lado;
  const o = opaca.getContext("2d")!;
  o.fillStyle = "#f3e7cf";
  o.fillRect(0, 0, lado, lado);
  o.drawImage(saida, 0, 0);
  const jpeg = await paraBlob(opaca, "image/jpeg");
  if (!jpeg) throw new Error("Não consegui gerar a foto.");
  return jpeg;
}
