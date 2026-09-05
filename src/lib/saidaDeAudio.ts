/**
 * Saída de áudio da mesa — um grafo só, com um ganho por participante e um
 * ganho mestre no fim.
 *
 *   stream remoto → source → ganhoDoPeer → ganhoMestre → destination
 *
 * O ganho do peer é o volume individual e o mudo local; o mestre é o "mutar
 * meu fone". Os dois são GainNode porque é o único ponto do caminho de saída
 * que a gente controla de verdade — ver os dois avisos abaixo.
 *
 * ISTO É O CAMINHO DE RECEPÇÃO, e só ele. O microfone continua saindo cru por
 * padrão (ver `montarGrafoDeAudio` em useVoiceRoom): passar a CAPTURA por Web
 * Audio nos custou áudio baixo e eco, porque o navegador só aplica
 * cancelamento de eco e ganho automático na faixa que ele mesmo capturou.
 * Nada disso vale para o que chega dos outros: a faixa já veio pronta do outro
 * lado, e processá-la aqui não tira processamento nenhum de ninguém.
 *
 * DOIS DETALHES QUE PARECEM SUPÉRFLUOS E NÃO SÃO:
 *
 * 1. O <audio> continua existindo, com muted = true. No Chrome, um MediaStream
 *    que veio de WebRTC não flui para o Web Audio enquanto não estiver TAMBÉM
 *    anexado a um elemento de mídia: o MediaStreamAudioSourceNode entrega
 *    silêncio. O elemento existe para destravar a faixa, não para tocar — quem
 *    toca é o destination do contexto. Removê-lo faz o áudio sumir por
 *    completo, e some sem erro nenhum no console.
 *
 * 2. Ninguém aqui usa `elemento.volume`. Com a faixa passando pelo contexto, o
 *    volume do elemento não tem efeito sobre o que sai pelo destination. Todo
 *    controle é GainNode, sempre.
 */

/**
 * Constante de tempo do `setTargetAtTime`. Trocar o ganho na marra
 * (`gain.value = x`) é um degrau na forma de onda, e degrau é estalo no fone —
 * o mesmo estalo em toda mexida de slider e em todo mudo. ~20 ms é rápido o
 * bastante para o clique parecer instantâneo e lento o bastante para não
 * estalar.
 */
const SUAVIZACAO = 0.02;

/**
 * Teto do volume individual. Acima de 1.0 o sinal é AMPLIFICADO, e amplificar
 * uma faixa que já vem no talo do outro lado clipa — distorce, não fica mais
 * alto. É o mesmo teto do Discord, e existe pela mesma razão: às vezes a
 * pessoa está baixa na origem e não tem outro jeito. Quem passa de 100% está
 * escolhendo o risco.
 */
export const VOLUME_MAXIMO = 2;

/** Ganho que de fato vai ao nó: mudo vence o volume, e não o apaga. */
export function ganhoEfetivo(volume: number, muted: boolean) {
  return muted ? 0 : volume;
}

type Ramo = {
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  /** Só para o Chrome deixar a faixa fluir. Ver o aviso 1 no topo. */
  elemento: HTMLAudioElement;
};

export type SaidaDeAudio = {
  /** Liga (ou religa) um participante. Chamar de novo com o mesmo stream não faz nada. */
  conectar: (userId: string, stream: MediaStream) => void;
  /** Desfaz o ramo daquele participante. Obrigatório no teardown do peer. */
  desconectar: (userId: string) => void;
  definirGanhoDoPeer: (userId: string, ganho: number) => void;
  definirGanhoMestre: (ganho: number) => void;
  /** Saída de som para um fone específico, quando o navegador deixa. */
  definirDispositivo: (speakerId: string | null) => void;
  /** O contexto nasce suspenso até um gesto do usuário. Barato chamar à toa. */
  retomar: () => void;
  destruir: () => void;
};

/**
 * Monta a saída. Devolve `null` num navegador sem Web Audio — quem chama
 * precisa saber, porque nesse caso não há como controlar volume nenhum.
 */
export function criarSaidaDeAudio(): SaidaDeAudio | null {
  if (typeof window === "undefined") return null;
  const AudioCtx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  // Sem sampleRate pedido de propósito: aqui não roda modelo nenhum (o GTCRN
  // vive no caminho de ENVIO), então o melhor é a taxa nativa da placa, que
  // não obriga o navegador a reamostrar tudo que chega.
  const ctx = new AudioCtx();
  const mestre = ctx.createGain();
  mestre.gain.value = 1;
  mestre.connect(ctx.destination);

  const ramos = new Map<string, Ramo>();
  let vivo = true;

  const suavizar = (param: AudioParam, valor: number) => {
    // cancelAndHoldAtTime não existe no Firefox; sem ele, uma rampa anterior
    // ainda em curso disputa com a nova. Segurar o valor atual antes de mirar
    // o novo resolve nos dois casos.
    param.cancelScheduledValues(ctx.currentTime);
    param.setValueAtTime(param.value, ctx.currentTime);
    param.setTargetAtTime(valor, ctx.currentTime, SUAVIZACAO);
  };

  const retomar = () => {
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  };

  const soltar = (ramo: Ramo) => {
    ramo.source.disconnect();
    ramo.gain.disconnect();
    // Largar o srcObject é o que solta a referência ao stream remoto. Sem
    // isso, quinze pessoas entrando e saindo deixam quinze elementos vivos
    // segurando quinze streams.
    ramo.elemento.srcObject = null;
    ramo.elemento.remove();
  };

  const montar = (userId: string, stream: MediaStream, ganhoInicial: number) => {
    const elemento = document.createElement("audio");
    elemento.autoplay = true;
    // playsinline por atributo: o iOS exige, e a propriedade só existe em
    // HTMLVideoElement na tipagem do DOM.
    elemento.setAttribute("playsinline", "");
    // muted, e não volume = 0: o elemento não é a saída, é só o destravador
    // da faixa. Ver o aviso 1 no topo do arquivo.
    elemento.muted = true;
    elemento.srcObject = stream;
    document.body.appendChild(elemento);
    // play() pode ser recusado antes do primeiro gesto; o elemento está mudo
    // e o áudio de verdade sai pelo contexto, então recusa não é problema.
    void elemento.play().catch(() => undefined);

    const source = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    gain.gain.value = ganhoInicial;
    source.connect(gain);
    gain.connect(mestre);

    ramos.set(userId, { source, gain, elemento });
    retomar();
  };

  return {
    conectar(userId, stream) {
      if (!vivo) return;
      const atual = ramos.get(userId);
      if (atual) {
        // Mesmo stream: nada a fazer, e é o caso comum — este método roda a
        // cada remontagem do efeito.
        if (atual.elemento.srcObject === stream) return;
        // Stream novo (o peer reconectou): refaz o ramo preservando o ganho. O
        // volume que eu escolhi para a pessoa não pode voltar a 100% só porque
        // a conexão dela caiu e voltou.
        const ganho = atual.gain.gain.value;
        soltar(atual);
        ramos.delete(userId);
        montar(userId, stream, ganho);
        return;
      }
      montar(userId, stream, 1);
    },

    desconectar(userId) {
      const ramo = ramos.get(userId);
      if (!ramo) return;
      ramos.delete(userId);
      soltar(ramo);
    },

    definirGanhoDoPeer(userId, ganho) {
      const ramo = ramos.get(userId);
      if (ramo) suavizar(ramo.gain.gain, ganho);
    },

    definirGanhoMestre(ganho) {
      suavizar(mestre.gain, ganho);
    },

    definirDispositivo(speakerId) {
      // setSinkId no AudioContext é recente (Chrome 110+) e não existe no
      // Firefox. Sem ele o som sai no aparelho padrão do sistema: degrada, não
      // quebra. Os elementos <audio> estão mudos, então mandar o sinkId para
      // eles não adiantaria nada — quem toca é o contexto.
      const comSink = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
      if (!comSink.setSinkId || !speakerId) return;
      void comSink.setSinkId(speakerId).catch(() => undefined);
    },

    retomar,

    destruir() {
      vivo = false;
      ramos.forEach(soltar);
      ramos.clear();
      mestre.disconnect();
      void ctx.close().catch(() => undefined);
    },
  };
}
