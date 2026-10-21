/**
 * Encontros marcados no buteco. O banco guarda o horário de início e quem
 * disse "vou" (salvar_encontro, confirmar_presenca); aqui fica o que a tela
 * precisa: o que ainda está em pauta, como dizer quando é, e o campo de data.
 */

/** Depois de começar, o encontro segue em destaque por 3 horas: a turma ainda está lá. */
export const DURA_MS = 3 * 60 * 60 * 1000;

export type Presenca = { user_id: string; vou: boolean };

export type Encontro = {
  id: string;
  titulo: string;
  descricao: string;
  comeca_em: string;
  mesa_id: string | null;
  criado_por: string | null;
  presencas: Presenca[];
};

/** O que ainda não acabou, do mais perto para o mais longe. */
export function emPauta<E extends Pick<Encontro, "comeca_em">>(encontros: E[], agora = new Date()) {
  return encontros
    .filter((e) => new Date(e.comeca_em).getTime() + DURA_MS > agora.getTime())
    .sort((a, b) => new Date(a.comeca_em).getTime() - new Date(b.comeca_em).getTime());
}

export function quemVai(presencas: Presenca[]) {
  return presencas.filter((p) => p.vou).map((p) => p.user_id);
}

const DIA_MS = 86_400_000;
const meiaNoite = (d: Date) => new Date(d).setHours(0, 0, 0, 0);

/**
 * Quando é, do jeito que se fala: "acontecendo agora", "começa em 35 min",
 * "hoje às 21:00", "amanhã às 21:00", "sáb às 21:00", "25/10 às 21:00".
 * `jaComecou` acende o destaque; `logo` é a primeira hora antes de começar.
 */
export function quandoE(comecaEm: string, agora = new Date()) {
  const inicio = new Date(comecaEm);
  const falta = inicio.getTime() - agora.getTime();
  if (falta <= 0) return { rotulo: "acontecendo agora", jaComecou: true, logo: false };
  const min = Math.ceil(falta / 60_000);
  if (min <= 60) return { rotulo: `começa em ${min} min`, jaComecou: false, logo: true };
  const hora = inicio.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const dias = Math.round((meiaNoite(inicio) - meiaNoite(agora)) / DIA_MS);
  const dia =
    dias === 0
      ? "hoje"
      : dias === 1
        ? "amanhã"
        : dias < 7
          ? inicio.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")
          : inicio.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return { rotulo: `${dia} às ${hora}`, jaComecou: false, logo: false };
}

const dois = (n: number) => String(n).padStart(2, "0");

/** Valor para <input type="datetime-local">, no fuso de quem está usando. */
export function paraCampoLocal(d: Date) {
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}T${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

/** O contrário: o texto do campo vira data, ou null se veio vazio ou torto. */
export function doCampoLocal(valor: string): Date | null {
  const m = valor.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, a, me, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const data = new Date(a, me - 1, d, h, mi);
  return Number.isNaN(data.getTime()) || data.getMonth() !== me - 1 ? null : data;
}

/** Sugestão para um encontro novo: hoje às 21h, ou amanhã se já passou das 20h. */
export function horarioSugerido(agora = new Date()) {
  const d = new Date(agora);
  if (d.getHours() >= 20) d.setDate(d.getDate() + 1);
  d.setHours(21, 0, 0, 0);
  return d;
}
