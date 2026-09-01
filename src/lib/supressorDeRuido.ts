/**
 * Supressão de ruído por IA (GTCRN) — o lado leve.
 *
 * Aqui não entra nada do modelo: o pacote, o worklet e os ~197 KB de wasm
 * moram em `gtcrn.ts`, que só é buscado por `import()` quando alguém liga o
 * interruptor. Quem deixa desligado (o padrão) não paga um byte.
 *
 * A forma é irmã da `ponteDeGate`, e de propósito não compartilha código com
 * ela: o gate liga e desliga na hora e tem um parâmetro ao vivo, enquanto este
 * aqui tem um carregamento pesado que pode simplesmente não dar certo. Juntar
 * os dois num abstrato só esconderia essa diferença.
 */

/**
 * O modelo foi treinado em 16 e 48 kHz e o worklet estoura em qualquer outra
 * taxa. Placa em 44,1 kHz existe, então quem monta o grafo abre o contexto
 * pedindo 48 kHz — e se o navegador não der, a IA fica indisponível em vez de
 * derrubar o áudio.
 */
export const TAXA_DO_MODELO = 48000;
export function taxaServe(taxa: number) {
  return taxa === 48000 || taxa === 16000;
}

/**
 * O que mostrar para quem ligou o interruptor. "indisponivel" é definitivo
 * nesta sessão: navegador sem AudioWorklet, taxa que o modelo não aceita, ou
 * o modelo não baixou.
 */
export type EstadoDoSupressor = "desligado" | "carregando" | "ligado" | "indisponivel";

export type PonteDeSupressor = {
  /** Estado desejado. Chamar de novo com o mesmo valor não faz nada. */
  sincronizar: (ligado: boolean) => void;
  destruir: () => void;
};

/**
 * Gerencia o GTCRN opcional entre dois nós que já estão ligados um no outro.
 * Ligado, a ligação vira `entrada → gtcrn → saída`; desligado, volta a ser
 * `entrada → saída`.
 *
 * O token é o que segura a corrida óbvia: entre pedir o modelo e ele chegar dá
 * tempo de a pessoa desligar, fechar o teste ou sair da mesa. E desligar é
 * sempre síncrono — é a válvula de escape se a IA estiver comendo voz, e ela
 * não pode depender de um await.
 */
export function ponteDeSupressor(
  ctx: AudioContext,
  entrada: AudioNode,
  saida: AudioNode,
  aoMudarEstado?: (estado: EstadoDoSupressor) => void,
): PonteDeSupressor {
  let no: AudioWorkletNode | null = null;
  let destruirNo: ((no: AudioWorkletNode) => void) | null = null;
  let token = 0;
  let carregando = false;
  let indisponivel = false;
  let vivo = true;

  const avisar = (estado: EstadoDoSupressor) => {
    if (vivo) aoMudarEstado?.(estado);
  };

  const remover = () => {
    token++;
    carregando = false;
    const atual = no;
    if (!atual) return;
    no = null;
    atual.onprocessorerror = null;
    entrada.disconnect();
    atual.disconnect();
    entrada.connect(saida);
    // Só depois de tirar da cadeia: destruir um nó ainda conectado deixaria o
    // worklet processando em cima de memória já liberada.
    destruirNo?.(atual);
    destruirNo = null;
  };

  return {
    sincronizar(ligado) {
      if (!vivo) return;
      if (!ligado) {
        remover();
        avisar("desligado");
        return;
      }
      if (no || carregando) return;
      if (indisponivel || !taxaServe(ctx.sampleRate)) {
        indisponivel = true;
        avisar("indisponivel");
        return;
      }

      carregando = true;
      const meu = ++token;
      avisar("carregando");
      void import("./gtcrn")
        .then(async (m) => ({ novo: await m.criarNoDoGtcrn(ctx), destruir: m.destruirNoDoGtcrn }))
        .catch(() => ({ novo: null, destruir: null }))
        .then(({ novo, destruir }) => {
          carregando = false;
          if (!novo) {
            // Falha aberta: pior do que ficar sem IA é ficar mudo.
            indisponivel = true;
            avisar("indisponivel");
            return;
          }
          if (!vivo || meu !== token) {
            novo.disconnect();
            destruir?.(novo);
            return;
          }
          // Se o modelo quebrar no meio do caminho, sai da cadeia sozinho em
          // vez de deixar a mesa no silêncio.
          novo.onprocessorerror = () => {
            indisponivel = true;
            remover();
            avisar("indisponivel");
          };
          entrada.disconnect();
          entrada.connect(novo);
          novo.connect(saida);
          no = novo;
          destruirNo = destruir;
          avisar("ligado");
        });
    },
    destruir() {
      remover();
      vivo = false;
    },
  };
}
