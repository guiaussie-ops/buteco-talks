/**
 * O histórico da gestão (RPC historico_da_gestao) em frases. O banco guarda
 * o código da ação e os detalhes crus; aqui vira "mudou Fulano de Membro
 * para Admin". Quem fez aparece separado, em destaque, na tela.
 */

import { ROTULO, type Cargo } from "@/lib/cargos";

export type TipoDeAcao = "membros" | "convites" | "buteco";

export type AcaoDaGestao = {
  acao: string;
  detalhes: unknown;
  alvo_nome: string | null;
};

/** As chaves que as RPCs e os gatilhos gravam em `detalhes`. */
type Detalhes = Partial<
  Record<
    | "de"
    | "para"
    | "motivo"
    | "final"
    | "validade_min"
    | "max_usos"
    | "link_fixo"
    | "nome"
    | "nome_antes"
    | "emoji"
    | "tipo"
    | "titulo"
    | "comeca_em",
    unknown
  >
>;

const texto = (v: unknown) => (typeof v === "string" ? v : "");
const numero = (v: unknown) => (typeof v === "number" ? v : null);

function cargo(v: unknown) {
  const c = texto(v);
  return c in ROTULO ? ROTULO[c as Cargo] : c || "?";
}

/** Os 4 últimos caracteres do código: dá para reconhecer sem expor o link. */
function convite(d: Detalhes) {
  const final = texto(d.final);
  return final ? `o convite …${final}` : "um convite";
}

export function validadeEmTexto(minutos: number | null) {
  if (minutos === null) return "sem prazo";
  if (minutos < 60) return `${minutos} min`;
  if (minutos < 24 * 60) return `${Math.round(minutos / 60)} h`;
  const dias = Math.round(minutos / (24 * 60));
  return dias === 1 ? "1 dia" : `${dias} dias`;
}

function dataDoEncontro(d: Detalhes) {
  const quando = new Date(texto(d.comeca_em));
  if (Number.isNaN(quando.getTime())) return "";
  return `Marcado para ${quando.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${quando.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

function mesa(d: Detalhes) {
  return d.tipo === "voice" ? "a mesa de voz" : "a mesa de texto";
}

const TIPO: Record<string, TipoDeAcao> = {
  mudou_cargo: "membros",
  expulsou: "membros",
  baniu: "membros",
  desbaniu: "membros",
  entrou: "membros",
  criou_convite: "convites",
  revogou_convite: "convites",
  trocou_link: "convites",
};

export function tipoDaAcao(acao: string): TipoDeAcao {
  return TIPO[acao] ?? "buteco";
}

/** A frase sem o autor ("baniu Fulano") e, quando tem, um detalhe para a segunda linha. */
export function descreverAcao(a: AcaoDaGestao): { frase: string; detalhe?: string } {
  const d = (a.detalhes && typeof a.detalhes === "object" ? a.detalhes : {}) as Detalhes;
  const alvo = a.alvo_nome || "alguém que saiu";
  switch (a.acao) {
    case "mudou_cargo":
      return { frase: `mudou ${alvo} de ${cargo(d.de)} para ${cargo(d.para)}` };
    case "expulsou":
      return { frase: `expulsou ${alvo}` };
    case "baniu":
      return d.motivo
        ? { frase: `baniu ${alvo}`, detalhe: `Motivo: ${texto(d.motivo)}` }
        : { frase: `baniu ${alvo}` };
    case "desbaniu":
      return { frase: `desbaniu ${alvo}` };
    case "entrou":
      return { frase: d.link_fixo ? "entrou pelo link fixo" : `entrou usando ${convite(d)}` };
    case "criou_convite": {
      const max = numero(d.max_usos);
      return {
        frase: `criou ${convite(d)}`,
        detalhe: `Vale ${validadeEmTexto(numero(d.validade_min))}, ${
          max === null ? "sem limite de usos" : max === 1 ? "1 uso" : `${max} usos`
        }`,
      };
    }
    case "revogou_convite":
      return { frase: `revogou ${convite(d)}` };
    case "trocou_link":
      return { frase: "trocou o link fixo do convite", detalhe: "O link antigo parou de valer" };
    case "editou_quadro":
      return { frase: "atualizou o quadro do salão" };
    case "editou_buteco": {
      const nome = texto(d.nome);
      const antes = texto(d.nome_antes);
      if (nome && antes && nome !== antes) {
        return { frase: `renomeou o buteco de "${antes}" para "${nome}"` };
      }
      return { frase: `trocou a placa da porta para ${texto(d.emoji) || "a inicial"}` };
    }
    case "criou_mesa":
      return { frase: `abriu ${mesa(d)} "${texto(d.nome)}"` };
    case "apagou_mesa":
      return { frase: `apagou ${mesa(d)} "${texto(d.nome)}"` };
    case "renomeou_mesa":
      return { frase: `renomeou ${mesa(d)} "${texto(d.de)}" para "${texto(d.para)}"` };
    case "marcou_encontro":
      return { frase: `marcou o encontro "${texto(d.titulo)}"`, detalhe: dataDoEncontro(d) };
    case "mudou_encontro":
      return { frase: `mudou o encontro "${texto(d.titulo)}"`, detalhe: dataDoEncontro(d) };
    case "cancelou_encontro":
      return { frase: `cancelou o encontro "${texto(d.titulo)}"`, detalhe: dataDoEncontro(d) };
    default:
      return { frase: a.acao.replace(/_/g, " ") };
  }
}

/** "agora há pouco", "há 5 min", "há 3 h", "ontem às 21:04", "12/10 às 09:30". */
export function quandoFoi(iso: string, agora = new Date()) {
  const data = new Date(iso);
  const min = Math.floor((agora.getTime() - data.getTime()) / 60000);
  if (min < 1) return "agora há pouco";
  if (min < 60) return `há ${min} min`;
  const hora = data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const dias = Math.round(
    (new Date(agora).setHours(0, 0, 0, 0) - new Date(data).setHours(0, 0, 0, 0)) / 86_400_000,
  );
  if (dias === 0) return `há ${Math.floor(min / 60)} h`;
  if (dias === 1) return `ontem às ${hora}`;
  return `${data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${hora}`;
}
