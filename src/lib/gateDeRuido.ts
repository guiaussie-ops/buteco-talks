/**
 * Gate de ruído: o lado do app. O processamento em si vive em
 * public/audio/gate-de-ruido.js, que roda na thread de áudio.
 *
 * Aqui ficam a escala do limiar (compartilhada com o medidor do teste de
 * microfone) e o carregamento do worklet, que falha aberto: sem worklet, o
 * áudio segue pelo caminho normal em vez de a mesa ficar muda.
 */

/** O medidor satura bem antes do clipping: 0.35 de RMS já é fala alta. */
export const RMS_CHEIO = 0.35;

/**
 * Ganho aplicado quando o gate está fechado: -24 dB. Não é zero de propósito —
 * um resíduo baixinho do ambiente mantém a linha viva, em vez de soar como
 * queda de conexão entre uma frase e outra.
 */
export const PISO_DO_GATE = 0.063;

/** Onde o limiar nasce, na escala do medidor: logo acima da respiração. */
export const LIMIAR_PADRAO = 0.06;
/** Acima disso o gate começaria a comer voz normal; não deixa arrastar além. */
export const LIMIAR_MAXIMO = 0.4;

const CAMINHO_DO_WORKLET = "/audio/gate-de-ruido.js";

/**
 * O limiar é guardado na mesma escala do medidor (0 a 1) para que a posição do
 * slider seja literalmente a posição da linha na barra. O worklet compara com
 * RMS de verdade, então a conversão acontece aqui.
 */
export function limiarEmRms(limiarDoMedidor: number) {
  return Math.max(0, Math.min(1, limiarDoMedidor)) * RMS_CHEIO;
}

/** Um addModule por contexto; chamar duas vezes é erro no Firefox. */
const carregados = new WeakMap<BaseAudioContext, Promise<boolean>>();

/**
 * Garante o worklet registrado no contexto. Devolve false — em vez de estourar —
 * se o navegador não tiver AudioWorklet ou o arquivo não carregar: quem chama
 * segue sem gate, que é melhor que seguir sem áudio.
 */
export function carregarWorklet(ctx: BaseAudioContext): Promise<boolean> {
  const jaPedido = carregados.get(ctx);
  if (jaPedido) return jaPedido;

  const pedido = (async () => {
    if (!ctx.audioWorklet) return false;
    try {
      await ctx.audioWorklet.addModule(CAMINHO_DO_WORKLET);
      return true;
    } catch {
      return false;
    }
  })();

  carregados.set(ctx, pedido);
  return pedido;
}

/** Cria o nó já com o limiar aplicado. null se o worklet não estiver disponível. */
export async function criarNoDoGate(
  ctx: BaseAudioContext,
  limiarDoMedidor: number,
): Promise<AudioWorkletNode | null> {
  if (!(await carregarWorklet(ctx))) return null;
  try {
    const no = new AudioWorkletNode(ctx, "gate-de-ruido", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    ajustarLimiar(no, limiarDoMedidor);
    return no;
  } catch {
    return null;
  }
}

/** Move o limiar de um nó já rodando, sem remontar nada. */
export function ajustarLimiar(no: AudioWorkletNode, limiarDoMedidor: number) {
  const p = no.parameters.get("limiar");
  if (p) p.value = limiarEmRms(limiarDoMedidor);
  const piso = no.parameters.get("piso");
  if (piso) piso.value = PISO_DO_GATE;
}

export type PonteDeGate = {
  /** Estado desejado; chamar de novo só move o limiar, não remonta nada. */
  sincronizar: (ligado: boolean, limiarDoMedidor: number) => void;
  destruir: () => void;
};

/**
 * Gerencia um gate opcional entre dois nós que já estão ligados um no outro.
 * Ligado, a ligação vira `entrada → gate → saída`; desligado, volta a ser
 * `entrada → saída`. Quem chama nunca vê o nó, então não tem como esquecer de
 * desconectar metade dele.
 *
 * A parte chata que isto encapsula: `addModule` é assíncrono. Entre pedir o
 * gate e ele chegar dá tempo de a pessoa desligar o gate, fechar o teste ou
 * sair da mesa — por isso o token, que descarta o que chega atrasado.
 *
 * Desligar é sempre síncrono: é a válvula de escape se o gate estiver comendo
 * voz, e ela não pode depender de um await.
 */
export function ponteDeGate(
  ctx: BaseAudioContext,
  entrada: AudioNode,
  saida: AudioNode,
  aoMudarEstado?: (aberto: boolean) => void,
): PonteDeGate {
  let no: AudioWorkletNode | null = null;
  let token = 0;
  let carregando = false;
  let vivo = true;

  const remover = () => {
    token++;
    carregando = false;
    const atual = no;
    if (!atual) return;
    no = null;
    atual.port.onmessage = null;
    entrada.disconnect();
    atual.disconnect();
    entrada.connect(saida);
    aoMudarEstado?.(true);
  };

  return {
    sincronizar(ligado, limiarDoMedidor) {
      if (!vivo) return;
      if (!ligado) {
        remover();
        return;
      }
      if (no) {
        ajustarLimiar(no, limiarDoMedidor);
        return;
      }
      if (carregando) return;

      carregando = true;
      const meu = ++token;
      void criarNoDoGate(ctx, limiarDoMedidor).then((novo) => {
        carregando = false;
        // Navegador sem AudioWorklet, ou o arquivo não carregou: falha aberto.
        // Pior do que ficar sem gate é ficar mudo.
        if (!novo) return;
        if (!vivo || meu !== token) {
          novo.disconnect();
          return;
        }
        if (aoMudarEstado) {
          novo.port.onmessage = (e: MessageEvent<{ aberto?: boolean }>) =>
            aoMudarEstado(e.data?.aberto !== false);
        }
        entrada.disconnect();
        entrada.connect(novo);
        novo.connect(saida);
        no = novo;
      });
    },
    destruir() {
      remover();
      vivo = false;
    },
  };
}
