/**
 * Gate de ruído — roda num AudioWorklet, na thread de áudio.
 *
 * Por que worklet e não requestAnimationFrame: rAF congela em aba minimizada, e
 * minimizar a janela para jogar é o uso normal do app. Um gate que para de
 * decidir com a aba escondida deixaria a mesa muda justo quando ninguém está
 * olhando para ela.
 *
 * Este arquivo mora em public/ e é carregado por addModule("/audio/gate-de-ruido.js").
 * Não passa pelo bundler de propósito: o caminho fica igual em dev e no deploy,
 * sem depender de como o Vite nomeia um asset. As constantes que o app também
 * precisa conhecer estão duplicadas em src/lib/gateDeRuido.ts — se mexer numa,
 * mexa na outra.
 */

/** Fecha só 6 dB abaixo do limiar de abertura. É a histerese: sem ela, uma voz
 *  parada em cima do limiar faz o gate tremular a cada bloco. */
const FECHA_RELATIVO = 0.5;
/** Depois que o nível cai, o gate ainda segura aberto por este tempo. É o que
 *  impede de comer o fim das palavras e as pausas curtas no meio da frase. */
const HOLD_S = 0.25;
/** Abertura quase instantânea: atrasar aqui corta a primeira sílaba. */
const ATTACK_S = 0.005;
/** Fechamento lento o bastante para soar como a sala silenciando, não como um corte. */
const RELEASE_S = 0.18;
/** Queda do detector de nível. Sobe na hora, desce devagar — assim um vale de
 *  um bloco no meio de uma vogal não conta como silêncio. */
const DETECTOR_S = 0.05;
/** De quanto em quanto tempo avisa a interface se está aberto ou fechado. */
const AVISO_MS = 100;

/** Coeficiente de um filtro de um polo para a constante de tempo pedida. */
function coeficiente(tau, sampleRate) {
  if (tau <= 0) return 1;
  return 1 - Math.exp(-1 / (tau * sampleRate));
}

class GateDeRuido extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      // Limiar em RMS linear. 0 desliga na prática (tudo passa).
      { name: "limiar", defaultValue: 0.021, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      // Ganho quando fechado. Não é zero: um resíduo baixinho mantém a linha
      // viva, em vez de soar como queda de conexão entre uma frase e outra.
      { name: "piso", defaultValue: 0.063, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    this.nivel = 0;
    this.envelope = 1;
    this.aberto = true;
    /** Instante (em segundos do contexto) até quando o hold segura o gate aberto. */
    this.seguraAte = 0;
    this.ultimoAviso = 0;
    this.ultimoEstadoAvisado = null;
    /** Envelope do bloco atual, reaproveitado para não alocar a cada 2,7 ms. */
    this.curva = null;

    this.coefAttack = coeficiente(ATTACK_S, sampleRate);
    this.coefRelease = coeficiente(RELEASE_S, sampleRate);
    /** O detector anda uma vez por bloco, não por amostra: o coeficiente é para
     *  o bloco inteiro (128 amostras, ~2,7 ms a 48 kHz). */
    this.coefDetector = 0;
    this.tamanhoDoBloco = 0;
  }

  process(inputs, outputs, parameters) {
    const entrada = inputs[0];
    const saida = outputs[0];
    // Sem entrada ligada ainda: devolve silêncio mas continua vivo. Retornar
    // false aqui mataria o processador antes do grafo terminar de se montar.
    if (!entrada || entrada.length === 0 || !entrada[0]) return true;

    const canal = entrada[0];
    const n = canal.length;

    let soma = 0;
    for (let i = 0; i < n; i++) soma += canal[i] * canal[i];
    const rms = Math.sqrt(soma / n);

    // Detector: ataque instantâneo, queda amortecida.
    if (n !== this.tamanhoDoBloco) {
      this.tamanhoDoBloco = n;
      this.coefDetector = coeficiente(DETECTOR_S, sampleRate / n);
    }
    this.nivel = rms > this.nivel ? rms : this.nivel + (rms - this.nivel) * this.coefDetector;

    const limiar = parameters.limiar[0];
    const piso = parameters.piso[0];
    const agora = currentTime;

    if (this.nivel >= limiar) {
      this.aberto = true;
      this.seguraAte = agora + HOLD_S;
    } else if (this.aberto && this.nivel < limiar * FECHA_RELATIVO && agora >= this.seguraAte) {
      this.aberto = false;
    }

    const alvo = this.aberto ? 1 : piso;
    const coef = alvo > this.envelope ? this.coefAttack : this.coefRelease;

    // A curva do envelope é calculada uma vez e aplicada igual em todos os
    // canais. Recalcular por canal abriria um antes do outro — voz aqui é mono,
    // mas um dispositivo estéreo não pode virar um flanger.
    if (!this.curva || this.curva.length !== n) this.curva = new Float32Array(n);
    let env = this.envelope;
    for (let i = 0; i < n; i++) {
      env += (alvo - env) * coef;
      this.curva[i] = env;
    }
    this.envelope = env;

    const canais = Math.min(entrada.length, saida.length);
    for (let c = 0; c < canais; c++) {
      const dentro = entrada[c];
      const fora = saida[c];
      if (!dentro || !fora) continue;
      for (let i = 0; i < fora.length; i++) fora[i] = dentro[i] * this.curva[i];
    }

    // Aviso para a interface (a barrinha do teste muda de cor). Vai por porta e
    // com folga: postar a cada bloco seria 375 mensagens por segundo à toa.
    const ms = agora * 1000;
    if (ms - this.ultimoAviso >= AVISO_MS) {
      this.ultimoAviso = ms;
      if (this.aberto !== this.ultimoEstadoAvisado) {
        this.ultimoEstadoAvisado = this.aberto;
        this.port.postMessage({ aberto: this.aberto });
      }
    }

    return true;
  }
}

registerProcessor("gate-de-ruido", GateDeRuido);
