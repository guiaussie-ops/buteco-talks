/**
 * O GTCRN de verdade — e só ele.
 *
 * Este arquivo existe separado para ser um chunk à parte: os imports do pacote
 * e das duas URLs de asset ficam TODOS aqui, então quem nunca liga a supressão
 * por IA nunca baixa nada disto. Quem entra é o `import()` dinâmico lá em
 * `supressorDeRuido.ts`.
 *
 * `?url` não embute o arquivo no bundle: o Vite emite os dois assets com hash
 * em `/assets/` e deixa aqui só a string. Isso importa porque um AudioWorklet
 * precisa de uma URL de verdade para o `addModule`, e o `.wasm` precisa ser
 * baixado como binário.
 */
import { GtcrnWorkletNode, loadGtcrn } from "@sapphi-red/web-noise-suppressor";
import urlDoWasm from "@sapphi-red/web-noise-suppressor/gtcrn.wasm?url";
import urlDoWorklet from "@sapphi-red/web-noise-suppressor/gtcrnWorklet.js?url";

/**
 * ~197 KB. Baixado uma vez por aba e reaproveitado: ligar e desligar o
 * interruptor, ou abrir o teste de microfone depois de já ter entrado numa
 * mesa, não pode baixar o modelo de novo.
 */
let binario: Promise<ArrayBuffer> | null = null;
function baixarModelo() {
  binario ??= loadGtcrn({ url: urlDoWasm }).catch((e: unknown) => {
    // Não guardar a falha: sem isto, uma queda de rede no primeiro clique
    // deixaria a IA quebrada para sempre nesta aba.
    binario = null;
    throw e;
  });
  return binario;
}

/** Um addModule por contexto; chamar duas vezes é erro no Firefox. */
const registrados = new WeakMap<BaseAudioContext, Promise<void>>();
function registrarWorklet(ctx: BaseAudioContext) {
  let pedido = registrados.get(ctx);
  if (!pedido) {
    pedido = ctx.audioWorklet.addModule(urlDoWorklet);
    registrados.set(ctx, pedido);
  }
  return pedido;
}

/**
 * Cria o nó do GTCRN, ou devolve null se este navegador/contexto não der conta.
 * Falha aberta de propósito: quem chama segue sem supressão, nunca sem áudio.
 */
export async function criarNoDoGtcrn(ctx: AudioContext): Promise<AudioWorkletNode | null> {
  // A taxa do contexto já foi conferida pela ponte, que é quem sabe desistir
  // sem baixar o modelo.
  if (!ctx.audioWorklet || typeof AudioWorkletNode === "undefined") return null;
  try {
    const [wasmBinary] = await Promise.all([baixarModelo(), registrarWorklet(ctx)]);
    // Voz é mono, e a faixa já vem com channelCount 1 da captura.
    return new GtcrnWorkletNode(ctx, { maxChannels: 1, wasmBinary });
  } catch {
    return null;
  }
}

/** Libera a memória do wasm dentro do worklet. O nó não serve mais depois. */
export function destruirNoDoGtcrn(no: AudioWorkletNode) {
  (no as GtcrnWorkletNode).destroy();
}
