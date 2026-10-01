import { toast } from "sonner";

/**
 * Regras do chat que não dependem de React nem do Supabase: dias, agrupamento,
 * menções e o caminho das imagens. Ficam aqui para o ChatPanel só desenhar.
 */

export type Message = {
  id: string;
  channel_id: string;
  user_id: string;
  content: string;
  created_at: string;
  edited_at: string | null;
  reply_to: string | null;
  image_path: string | null;
};

export const MESSAGE_COLUMNS =
  "id, channel_id, user_id, content, created_at, edited_at, reply_to, image_path";

/** Janela em que mensagens seguidas da mesma pessoa viram um bloco só. */
const JANELA_DO_GRUPO_MS = 5 * 60 * 1000;

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function mesmoDia(a: string | Date, b: string | Date) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/** "hoje", "ontem" ou a data curta: o pedaço que vai ao lado do nome. */
export function formatDay(iso: string, agora = new Date()) {
  if (mesmoDia(iso, agora)) return "hoje";
  const ontem = new Date(agora);
  ontem.setDate(ontem.getDate() - 1);
  if (mesmoDia(iso, ontem)) return "ontem";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** Rótulo do separador de dia: "Hoje", "Ontem" ou "segunda-feira, 29 de setembro". */
export function rotuloDoDia(iso: string, agora = new Date()) {
  const curto = formatDay(iso, agora);
  if (curto === "hoje") return "Hoje";
  if (curto === "ontem") return "Ontem";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(d.getFullYear() !== agora.getFullYear() ? { year: "numeric" } : {}),
  });
}

/**
 * Se `msg` entra no bloco da anterior, sem repetir nome e tampinha. Resposta
 * sempre abre bloco novo, porque a citação precisa do cabeçalho em cima; e a
 * virada do dia também, porque o separador fica entre as duas.
 */
export function isGrouped(prev: Message | undefined, msg: Message) {
  if (!prev || prev.user_id !== msg.user_id || msg.reply_to) return false;
  if (!mesmoDia(prev.created_at, msg.created_at)) return false;
  return (
    new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() < JANELA_DO_GRUPO_MS
  );
}

/**
 * Se a mensagem fica abaixo da linha de "novas": é dos outros e chegou depois
 * do limiar. Compara por número, porque o banco devolve "+00:00" com
 * microssegundos e o navegador gera "Z" com milissegundos, e como texto os dois
 * formatos não se ordenam direito.
 */
export function depoisDe(msg: Message, limiar: string | null, meuId: string) {
  if (!limiar || msg.user_id === meuId) return false;
  return new Date(msg.created_at).getTime() > new Date(limiar).getTime();
}

// ---------------------------------------------------------------------------
// Menções
// ---------------------------------------------------------------------------

/** Mesma fronteira do `nao_lidas` no banco: letra, número ou "_" colam no nome. */
const COLA = /[\p{L}\p{N}_]/u;

export type Trecho =
  { tipo: "texto"; texto: string } | { tipo: "mencao"; texto: string; userId: string };

/**
 * Corta o texto em trechos de texto puro e de menção. Só vira menção o
 * "@username" de alguém do buteco; o resto do "@" fica como estava.
 *
 * O username pode ter ponto e hífen (nasce do e-mail), então não dá para achar
 * o fim da menção por regex: testa os usernames do mais longo para o mais
 * curto, para "@joao.silva" não virar "@joao" seguido de ".silva".
 */
export function trechos(texto: string, usernames: Record<string, string>): Trecho[] {
  const candidatos = Object.entries(usernames)
    .map(([userId, username]) => ({ userId, username: username.toLowerCase() }))
    .sort((a, b) => b.username.length - a.username.length);
  const baixo = texto.toLowerCase();
  const saida: Trecho[] = [];
  let desde = 0;

  for (let i = 0; i < texto.length; i++) {
    if (texto[i] !== "@" || (i > 0 && COLA.test(texto[i - 1]!))) continue;
    const achou = candidatos.find(
      ({ username }) =>
        baixo.startsWith(username, i + 1) && !COLA.test(texto[i + 1 + username.length] ?? ""),
    );
    if (!achou) continue;
    if (i > desde) saida.push({ tipo: "texto", texto: texto.slice(desde, i) });
    const fim = i + 1 + achou.username.length;
    saida.push({ tipo: "mencao", texto: texto.slice(i, fim), userId: achou.userId });
    desde = fim;
    i = fim - 1;
  }
  if (desde < texto.length) saida.push({ tipo: "texto", texto: texto.slice(desde) });
  return saida;
}

export function menciona(texto: string, userId: string, usernames: Record<string, string>) {
  return trechos(texto, usernames).some((t) => t.tipo === "mencao" && t.userId === userId);
}

/**
 * A menção que está sendo digitada no cursor, para o autocompletar: o "@" tem
 * que estar no começo ou depois de um espaço, e entre ele e o cursor não pode
 * ter espaço.
 */
export function mencaoEmAndamento(texto: string, cursor: number) {
  const antes = texto.slice(0, cursor);
  const m = /(^|\s)@([^\s@]*)$/.exec(antes);
  if (!m) return null;
  return { inicio: cursor - m[2]!.length - 1, termo: m[2]! };
}

// ---------------------------------------------------------------------------
// Imagens
// ---------------------------------------------------------------------------

export const IMAGEM_MAX_BYTES = 8 * 1024 * 1024;
export const IMAGEM_TIPOS = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const EXTENSOES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Confere tipo e tamanho antes de subir: o bucket recusaria do mesmo jeito,
 * mas sem dizer por quê.
 */
export function imagemValida(arquivo: File) {
  if (!IMAGEM_TIPOS.includes(arquivo.type)) {
    toast.error("Só dá pra mandar JPG, PNG, WEBP ou GIF.");
    return false;
  }
  if (arquivo.size > IMAGEM_MAX_BYTES) {
    toast.error("Essa imagem passa de 8 MB.");
    return false;
  }
  return true;
}

/** "<mesa>/<pessoa>/<uuid>.ext" — o banco e o bucket conferem as duas pastas. */
export function caminhoDaImagem(channelId: string, userId: string, tipo: string) {
  return `${channelId}/${userId}/${crypto.randomUUID()}.${EXTENSOES[tipo] ?? "bin"}`;
}

// ---------------------------------------------------------------------------
// Reações
// ---------------------------------------------------------------------------

export const EMOJIS_RAPIDOS = [
  "👍",
  "❤️",
  "😂",
  "😮",
  "😢",
  "😡",
  "🍺",
  "🔥",
  "🎉",
  "👀",
  "🙏",
  "💯",
  "👏",
  "🤝",
  "😎",
  "🤣",
];

export type Reacao = { message_id: string; user_id: string; emoji: string };

/** Agrupa as reações de uma mensagem por emoji, na ordem em que apareceram. */
export function resumoDeReacoes(reacoes: Reacao[]) {
  const porEmoji = new Map<string, string[]>();
  for (const r of reacoes) {
    const quem = porEmoji.get(r.emoji);
    if (quem) quem.push(r.user_id);
    else porEmoji.set(r.emoji, [r.user_id]);
  }
  return [...porEmoji].map(([emoji, userIds]) => ({ emoji, userIds }));
}

/** "Fulano está digitando…", "Fulano e Ciclano estão…", "Várias pessoas estão…". */
export function textoDigitando(nomes: string[]) {
  if (nomes.length === 0) return "";
  if (nomes.length === 1) return `${nomes[0]} está digitando…`;
  if (nomes.length === 2) return `${nomes[0]} e ${nomes[1]} estão digitando…`;
  if (nomes.length === 3) return `${nomes[0]}, ${nomes[1]} e ${nomes[2]} estão digitando…`;
  return "Várias pessoas estão digitando…";
}
