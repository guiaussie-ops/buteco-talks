import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  audioConstraints,
  filtrosDeAudio,
  videoConstraints,
  MEDIA_PREFS_PADRAO,
  type MediaPrefs,
} from "@/lib/mediaPrefs";
import { ponteDeGate, type PonteDeGate } from "@/lib/gateDeRuido";
import {
  TAXA_DO_MODELO,
  ponteDeSupressor,
  taxaServe,
  type PonteDeSupressor,
} from "@/lib/supressorDeRuido";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type RemotePeer = {
  userId: string;
  stream: MediaStream;
  hasVideo: boolean;
};

/** O que alguém pode estar transmitindo. */
export type Transmissao = "camera" | "screen";

/**
 * O que cada um publica na presença da mesa.
 *
 * `video` e `assistindo` são o que faz a transmissão ser opcional: quem
 * transmite lê os `assistindo` de todo mundo para saber para quem mandar a
 * faixa, e manda `null` para o resto.
 *
 * Isto vive na PRESENÇA e não no canal de sinalização de propósito. Um pedido
 * de "quero assistir" perdido num broadcast deixaria a pessoa esperando para
 * sempre por um vídeo que nunca vem. Presença é estado: sincroniza sozinha,
 * sobrevive a reconexão e pode ser reaplicada quantas vezes for.
 */
type PresencaDeVoz = {
  userId: string;
  at: number;
  video: "none" | Transmissao;
  assistindo: string[];
  /** Meu microfone está fechado. Vira o indicador na minha tampinha para os outros. */
  micOff: boolean;
  /** Estou de fone mudo. Também vai para a presença: quem fala comigo merece saber. */
  deafened: boolean;
};

/**
 * O que os OUTROS estão publicando sobre o áudio deles.
 *
 * Note o que não está aqui: se eu mutei alguém. Isso é uma decisão minha sobre
 * o meu fone, mora só no meu localStorage e não sai da minha aba — a pessoa
 * mutada não fica sabendo, e ninguém mais na mesa é afetado.
 */
export type EstadoDeAudio = { micOff: boolean; deafened: boolean };

type SignalPayload = {
  from: string;
  to: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" },
  ],
};

/**
 * Teto de banda do vídeo, por destinatário e em bits por segundo.
 *
 * Em malha não existe "o encoder": quem transmite para oito pessoas roda oito
 * encoders, cada um com a sua própria fila de subida. Sem teto, o WebRTC mira
 * a banda que ele ACHA que tem — e ele mede cada conexão isolada, sem saber
 * que há outras sete disputando o mesmo cabo. As oito estimativas somadas
 * passam de qualquer upload doméstico, a fila estoura, o ICE começa a perder
 * keepalive e a conexão vai para `disconnected`. O teto é o que impede a
 * transmissão de derrubar a si mesma.
 *
 * Tela é mais alta que câmera porque é onde está o detalhe que importa: texto
 * de jogo, código, planilha. Câmera é rosto, e rosto sobrevive bem em 600k.
 */
const TETO_TELA_BPS = 1_500_000;
const TETO_CAMERA_BPS = 600_000;

/**
 * Subida total que a gente se permite ocupar, dividida entre quem está
 * assistindo. É um chute deliberadamente conservador: 6 Mbps é o que sobra num
 * plano doméstico brasileiro razoável depois do resto da casa. Com uma pessoa
 * assistindo o teto por conexão manda; a partir de quatro, quem manda é o
 * orçamento.
 */
const ORCAMENTO_DE_SUBIDA_BPS = 6_000_000;

/**
 * Abaixo disto a tela vira sopa de blocos e não vale a pena transmitir. Se a
 * plateia crescer tanto que o orçamento não cobre, é melhor estourar um pouco
 * o orçamento do que mandar algo ilegível para todo mundo.
 */
const PISO_DE_BITRATE_BPS = 300_000;

/**
 * Backoff da volta por cima: 2s, 4s, 8s, 16s, e daí em diante de 30 em 30.
 *
 * Começa curto porque a maioria dos `disconnected` é um soluço de rede que se
 * resolve em segundos, e tenta para sempre porque o outro lado pode estar num
 * túnel de metrô: desistir deixaria a mesa quebrada até alguém entrar ou sair
 * para acordar a presença — que é exatamente o bug que isto conserta.
 */
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_TETO_MS = 30_000;

type PeerBox = {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  audioSender: RTCRtpSender | null;
  /**
   * Criado junto com o peer e nunca trocado: transmitir vira replaceTrack, e
   * parar vira replaceTrack(null). Sem addTrack/removeTrack não há renegociação
   * ao começar ou parar de transmitir — e sem renegociação não há a colisão de
   * ofertas que deixava uma de duas transmissões simultâneas na tela preta.
   */
  videoSender: RTCRtpSender | null;
  /**
   * Faixa de vídeo que este peer está recebendo agora — `null` quando ele não
   * pediu para assistir. Guardado para não chamar `replaceTrack` de novo a cada
   * sincronização de presença com o mesmo valor.
   */
  videoAtual: MediaStreamTrack | null;
  /** Negociação que falhou por estado instável e precisa ser refeita. */
  renegociarPendente: boolean;
  /** Tentativas de volta seguidas, sem sucesso no meio. Zera ao conectar. */
  tentativas: number;
  /** Tentativa agendada. Um por peer — o teardown depende disso para limpar. */
  timerDeVolta: number | null;
};

/**
 * Passar o áudio por Web Audio custa: a faixa deixa de ser a que o navegador
 * capturou. Só vale a pena quando há o que fazer com ela.
 */
function precisaDeGrafo(inputGain: number, noiseGate: boolean, noiseSuppressionIA: boolean) {
  return inputGain !== 1 || noiseGate || noiseSuppressionIA;
}

/**
 * WebRTC mesh room. Signaling rides on a Realtime broadcast channel.
 * Presence tells us who is in the room.
 */
export function useVoiceRoom(
  channelId: string | null,
  userId: string | null,
  prefs: MediaPrefs = MEDIA_PREFS_PADRAO,
  /** Estado do meu fone. Entra só para ser republicado na presença. */
  deafened = false,
) {
  const [connected, setConnected] = useState(false);
  const [micOn, setMicOnState] = useState(true);
  const [micStream, setMicStreamState] = useState<MediaStream | null>(null);
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);
  /**
   * Todo mundo que está na mesa, você inclusive — inclusive quem entrou sem
   * microfone. Vem da presença do Realtime, a MESMA que decide quem entra e
   * quem sai. Derivar isto de `remotePeers` era o que fazia o ouvinte sumir:
   * sem mídia não há `ontrack`, e sem `ontrack` a pessoa não existia na tela.
   */
  const [participants, setParticipants] = useState<string[]>([]);
  /** Quem está transmitindo agora, e o quê. Não implica receber nada. */
  const [transmissoes, setTransmissoes] = useState<Record<string, Transmissao>>({});
  /** Microfone fechado / fone mudo de cada um dos outros, lido da presença. */
  const [estadosDeAudio, setEstadosDeAudio] = useState<Record<string, EstadoDeAudio>>({});
  /** De quem EU pedi para receber vídeo. Nasce vazio: ninguém carrega sem pedir. */
  const [assistindo, setAssistindo] = useState<string[]>([]);
  const [localVideoStream, setLocalVideoStream] = useState<MediaStream | null>(null);
  const [videoMode, setVideoMode] = useState<"none" | "camera" | "screen">("none");
  const [error, setError] = useState<string | null>(null);

  const chanRef = useRef<RealtimeChannel | null>(null);
  const peersRef = useRef<Map<string, PeerBox>>(new Map());
  const micStreamRef = useRef<MediaStream | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  /**
   * Faixa crua do microfone. É ela que vai ao ar no caminho padrão: o navegador
   * só aplica cancelamento de eco e ganho automático na faixa que ele mesmo
   * capturou. Reencaminhar por Web Audio produz uma faixa sintética que perde
   * esse processamento — daí o áudio baixo e o eco.
   */
  const micRawRef = useRef<MediaStream | null>(null);
  const gainCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  /** Fim do grafo: é o stream dele que vai ao ar enquanto o grafo existir. */
  const destinoRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  /** Gate de ruído opcional, na segunda metade do grafo. */
  const ponteDoGateRef = useRef<PonteDeGate | null>(null);
  /** Supressão por IA opcional, na primeira metade. */
  const ponteDoSupressorRef = useRef<PonteDeSupressor | null>(null);
  /**
   * O contexto atual foi aberto já pedindo a taxa do modelo? Sem isto, um
   * navegador que recusa 48 kHz faria o grafo ser refeito a cada mexida no
   * slider, para sempre, tentando uma taxa que não vai vir.
   */
  const ctxPedidoParaIaRef = useRef(false);
  /** Espelho de micOn, para reaplicar o mudo quando a faixa publicada troca. */
  const micOnRef = useRef(true);
  /**
   * Quem pediu para assistir a MINHA transmissão, lido da presença dos outros.
   * É a lista que decide para quais peers a faixa de vídeo vai.
   */
  const quemQuerMeuVideoRef = useRef<Set<string>>(new Set());
  /** Espelhos para a presença ser republicada sem virar dependência de efeito. */
  const assistindoRef = useRef<string[]>([]);
  assistindoRef.current = assistindo;
  const videoModeRef = useRef<"none" | Transmissao>("none");
  const deafenedRef = useRef(false);
  /** Instante da entrada. Fixo, para republicar a presença não virar um diff. */
  const entradaRef = useRef(0);

  // As prefs entram por ref: mudar o volume não pode reconectar a mesa inteira.
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());

  const publish = useCallback(() => {
    setRemotePeers(
      Array.from(remoteStreamsRef.current.entries()).map(([id, stream]) => ({
        userId: id,
        stream,
        // Duas condições, e as duas são necessárias.
        //
        // Ter pedido, primeiro: sem isso o quadro de alguém pode voltar sozinho
        // depois de eu ter fechado, porque a faixa continua no receiver e um
        // `unmute` atrasado a reacende.
        //
        // E `muted`, depois, que é o que separa uma transmissão viva de uma que
        // o outro lado já encerrou: removeTrack/replaceTrack(null) deixam a
        // faixa remota muda, mas com readyState ainda em "live". Olhar só o
        // readyState era o que mantinha o último quadro congelado na tela.
        hasVideo:
          assistindoRef.current.includes(id) &&
          stream.getVideoTracks().some((t) => !t.muted && t.readyState === "live"),
      })),
    );
  }, []);

  const send = useCallback((payload: SignalPayload) => {
    void chanRef.current?.send({ type: "broadcast", event: "signal", payload });
  }, []);

  /**
   * Republica o meu estado na presença da mesa. Chamado ao entrar e sempre que
   * eu começo/paro de transmitir ou mudo de ideia sobre o que quero assistir.
   */
  const publicarPresenca = useCallback(() => {
    const chan = chanRef.current;
    if (!chan || !userId) return;
    const payload: PresencaDeVoz = {
      userId,
      at: entradaRef.current,
      video: videoModeRef.current,
      assistindo: assistindoRef.current,
      micOff: !micOnRef.current,
      deafened: deafenedRef.current,
    };
    void chan.track(payload).catch(() => undefined);
  }, [userId]);

  /**
   * Manda a minha faixa de vídeo só para quem pediu, e `null` para o resto.
   *
   * Em malha cada peer tem o seu próprio sender, então dá para transmitir para
   * uns e não para outros. Quem não pediu não recebe pacote nenhum: economiza a
   * banda dele e o encoder daquela conexão nem roda. E `replaceTrack` não
   * renegocia, então entrar e sair da transmissão não sacode a mesa.
   */
  /**
   * Põe o teto de banda no sender de vídeo de UM peer.
   *
   * `setParameters` não renegocia — é a mesma razão de `replaceTrack` ser o
   * caminho preferido aqui: o teto muda sem sacudir a mesa.
   */
  const aplicarTetoDeBitrate = useCallback((box: PeerBox) => {
    const sender = box.videoSender;
    const modo = videoModeRef.current;
    // Sem faixa no ar não há encoder para limitar, e mexer nos parâmetros de um
    // sender vazio só gasta chamada.
    if (!sender || !box.videoAtual || modo === "none") return;

    // O divisor é quem ASSISTE, não quem está na mesa: quem não pediu não tem
    // encoder rodando e não ocupa subida nenhuma. Numa mesa de quinze com dois
    // assistindo, o teto continua alto — e é o certo.
    const plateia = Math.max(1, quemQuerMeuVideoRef.current.size);
    const base = modo === "screen" ? TETO_TELA_BPS : TETO_CAMERA_BPS;
    const teto = Math.max(
      PISO_DE_BITRATE_BPS,
      Math.min(base, Math.round(ORCAMENTO_DE_SUBIDA_BPS / plateia)),
    );
    /**
     * Tela degrada em FPS, câmera degrada em resolução. Texto de jogo a 8 fps
     * ainda se lê; o mesmo texto reamostrado para meia resolução, não. Para
     * rosto vale o contrário, e é o padrão do navegador.
     */
    const degradacao: RTCDegradationPreference =
      modo === "screen" ? "maintain-resolution" : "balanced";

    const params = sender.getParameters();
    // Antes da primeira negociação o array pode vir vazio. Inventar uma camada
    // aqui não funciona: `setParameters` recusa mudar a QUANTIDADE de camadas,
    // e a chamada morreria no catch sem teto nenhum. Melhor desistir agora — o
    // handler de `connected` chama isto de novo quando houver o que limitar.
    const camada = params.encodings?.[0];
    if (!camada) return;
    if (camada.maxBitrate === teto && params.degradationPreference === degradacao) return;
    camada.maxBitrate = teto;
    params.degradationPreference = degradacao;
    // Recusa não é fatal: sem teto o vídeo ainda vai, só sem rédea.
    void sender.setParameters(params).catch(() => undefined);
  }, []);

  const aplicarVideoNosPeers = useCallback(() => {
    const track = videoStreamRef.current?.getVideoTracks()[0] ?? null;
    peersRef.current.forEach((box, id) => {
      const alvo = quemQuerMeuVideoRef.current.has(id) ? track : null;
      if (box.videoAtual !== alvo) {
        box.videoAtual = alvo;
        if (box.videoSender) {
          void box.videoSender.replaceTrack(alvo).catch(() => undefined);
        } else if (alvo && videoStreamRef.current) {
          // Só cai aqui num navegador sem addTransceiver, onde o sender não pôde
          // nascer junto com o peer. Aqui renegocia, e tudo bem: é o caminho raro.
          box.videoSender = box.pc.addTrack(alvo, videoStreamRef.current);
        }
      }
      // Fora do `if` de propósito: o teto depende do TAMANHO da plateia, então
      // alguém entrando ou saindo da transmissão muda a conta de todo mundo,
      // inclusive a dos peers cuja faixa não mudou nada.
      aplicarTetoDeBitrate(box);
    });
  }, [aplicarTetoDeBitrate]);

  /**
   * Prende a faixa recebida ao stream do participante e liga os avisos de
   * estado. Usado no `ontrack` e de novo quando eu volto a assistir alguém:
   * `replaceTrack` do outro lado NÃO dispara um segundo `ontrack`, então a
   * faixa que volta é sempre esta mesma, vinda do receiver.
   */
  const armarFaixa = useCallback(
    (remoteId: string, track: MediaStreamTrack) => {
      let stream = remoteStreamsRef.current.get(remoteId);
      if (!stream) {
        stream = new MediaStream();
        remoteStreamsRef.current.set(remoteId, stream);
      }
      const alvo = stream;
      // Uma faixa de vídeo por pessoa. Sem isso, quem parava e voltava a
      // transmitir deixava a faixa morta no stream, e o <video> renderiza a
      // primeira — a congelada — em vez da nova.
      if (track.kind === "video") {
        alvo.getVideoTracks().forEach((t) => {
          if (t.id !== track.id) alvo.removeTrack(t);
        });
      }
      if (!alvo.getTracks().some((t) => t.id === track.id)) alvo.addTrack(track);
      track.onended = () => {
        alvo.removeTrack(track);
        publish();
      };
      track.onmute = publish;
      track.onunmute = publish;
      publish();
    },
    [publish],
  );

  /**
   * Repesca a faixa de vídeo que já está no receiver e a prende de volta ao
   * stream da pessoa. É o mesmo movimento do `assistir`, isolado aqui porque a
   * reconstrução do peer precisa dele pelo mesmo motivo: `replaceTrack` do
   * outro lado não dispara `ontrack`, e um peer recriado começa com o stream
   * remoto zerado. Sem isto, quem estava assistindo quando a conexão caiu
   * ficava com `assistindo` ligado e nenhuma faixa — o botão dizia "assistindo"
   * e a tela ficava vazia até um clique em parar e assistir de novo.
   *
   * Idempotente: `armarFaixa` não duplica a faixa que já está no stream, então
   * chamar a cada `connected` não custa nada quando o `ontrack` já resolveu.
   */
  const repescarVideo = useCallback(
    (remoteId: string) => {
      if (!assistindoRef.current.includes(remoteId)) return;
      const faixa = peersRef.current
        .get(remoteId)
        ?.pc.getReceivers()
        .find((r) => r.track?.kind === "video")?.track;
      if (faixa) armarFaixa(remoteId, faixa);
    },
    [armarFaixa],
  );

  /**
   * Solta o vídeo que estou RECEBENDO de alguém, sem encostar no áudio dela.
   *
   * Esperar o outro lado não funciona, e é isto que deixava o botão "Parar de
   * assistir" sem efeito: `replaceTrack(null)` lá NÃO encerra a faixa aqui, só
   * a deixa muda. `onended` nunca vem, e o `onmute` que sobra só chega depois
   * de uma ida e volta pela presença — se ela demorar ou se perder, o quadro
   * fica na tela para sempre. Quem manda em parar de ver sou eu, na hora.
   *
   * O stream é mutado NO LUGAR, de propósito. Trocá-lo por um MediaStream novo
   * faria `saidaDeAudio.conectar` enxergar outro stream e refazer o ramo de
   * áudio da pessoa — fechar a tela de alguém cortaria a voz dela por um
   * instante. É a identidade do stream que segura o ramo de pé.
   *
   * A faixa NÃO é parada com `stop()`: ela é a mesma que volta se eu pedir de
   * novo, e uma faixa remota parada não ressuscita.
   */
  const soltarVideoRecebido = useCallback(
    (remoteId: string) => {
      const stream = remoteStreamsRef.current.get(remoteId);
      const faixas = stream?.getVideoTracks() ?? [];
      if (!stream || faixas.length === 0) return;
      faixas.forEach((t) => {
        t.onended = null;
        t.onmute = null;
        t.onunmute = null;
        stream.removeTrack(t);
      });
      publish();
    },
    [publish],
  );

  /** Peço para receber o vídeo de alguém. O pedido viaja na presença. */
  const assistir = useCallback(
    (remoteId: string) => {
      if (!assistindoRef.current.includes(remoteId)) {
        // O ref anda antes do estado: `publish` lê a lista daqui, e ele roda
        // ainda dentro deste clique.
        assistindoRef.current = [...assistindoRef.current, remoteId];
      }
      repescarVideo(remoteId);
      setAssistindo((prev) => (prev.includes(remoteId) ? prev : [...prev, remoteId]));
    },
    [repescarVideo],
  );

  /**
   * Paro de receber. A desmontagem é local e imediata — para de renderizar,
   * solta a faixa — e só DEPOIS o pedido viaja: o efeito de `assistindo`
   * republica a presença, e do outro lado o sender volta a mandar `null`, que
   * é o que devolve a banda.
   */
  const pararDeAssistir = useCallback(
    (remoteId: string) => {
      assistindoRef.current = assistindoRef.current.filter((id) => id !== remoteId);
      soltarVideoRecebido(remoteId);
      setAssistindo((prev) =>
        prev.includes(remoteId) ? prev.filter((id) => id !== remoteId) : prev,
      );
    },
    [soltarVideoRecebido],
  );

  /** Reaplica o botão de mudo na faixa que acabou de entrar no ar. */
  const aplicarMudo = useCallback((stream: MediaStream | null) => {
    stream?.getAudioTracks().forEach((t) => (t.enabled = micOnRef.current));
  }, []);

  /**
   * Troca a faixa de áudio publicada em todos os peers. replaceTrack não dispara
   * renegociação, então ligar ou desligar o ganho não derruba ninguém da mesa.
   */
  const publicarFaixaDeAudio = useCallback(
    (stream: MediaStream | null) => {
      const track = stream?.getAudioTracks()[0] ?? null;
      micStreamRef.current = stream;
      aplicarMudo(stream);
      setMicStreamState(stream);
      peersRef.current.forEach((box) => {
        void box.audioSender?.replaceTrack(track).catch(() => undefined);
      });
    },
    [aplicarMudo],
  );

  /**
   * Põe a IA e o gate no estado que as preferências pedem, dentro do grafo que
   * já existe. A faixa publicada não muda: quem sai do grafo é sempre o mesmo
   * destino, então ninguém na mesa percebe nada além do áudio mudar.
   */
  const sincronizarProcessamento = useCallback(() => {
    const { noiseGate, noiseGateThreshold, noiseSuppressionIA } = prefsRef.current;
    ponteDoSupressorRef.current?.sincronizar(noiseSuppressionIA);
    ponteDoGateRef.current?.sincronizar(noiseGate, noiseGateThreshold);
  }, []);

  /** Volta a publicar a faixa crua e derruba o grafo. */
  const desmontarGrafoDeAudio = useCallback(() => {
    if (!gainCtxRef.current && !gainNodeRef.current) return;
    // Antes do close(): as pontes ainda mexem nas conexões ao se desfazer.
    ponteDoSupressorRef.current?.destruir();
    ponteDoSupressorRef.current = null;
    ponteDoGateRef.current?.destruir();
    ponteDoGateRef.current = null;
    destinoRef.current = null;
    void gainCtxRef.current?.close().catch(() => undefined);
    gainCtxRef.current = null;
    gainNodeRef.current = null;
    ctxPedidoParaIaRef.current = false;
    publicarFaixaDeAudio(micRawRef.current);
  }, [publicarFaixaDeAudio]);

  /**
   * Só é montado quando a pessoa mexe no volume de entrada, liga o gate ou liga
   * a IA. Sem nenhum dos três, a mesa recebe a faixa crua, sem nenhum
   * processamento nosso.
   *
   * O grafo é `mic → ganho → [IA] → meio → [gate] → destino`.
   *
   * A ordem não é à toa. Os dois ficam DEPOIS do ganho para o limiar do gate
   * viver na mesma escala do medidor do teste — a linha do limiar não passeia
   * quando alguém mexe no volume de entrada. E a IA vem ANTES do gate porque
   * ela é quem tira o ruído de dentro da voz; o gate só decide passa/não passa,
   * e decide melhor sobre um sinal já limpo.
   *
   * `meio` é um ganho unitário que só serve de emenda: com ele cada ponte mexe
   * apenas no próprio trecho, e ligar um processador nunca desconecta o outro.
   */
  const montarGrafoDeAudio = useCallback(() => {
    const cru = micRawRef.current;
    if (!cru) return;
    const { inputGain, noiseSuppressionIA } = prefsRef.current;
    const ctxAtual = gainCtxRef.current;
    if (ctxAtual && gainNodeRef.current) {
      // A taxa nasce com o contexto e não se muda depois. Se a IA acabou de ser
      // ligada num contexto que o modelo não aceita, o jeito é refazer o grafo:
      // a faixa publicada troca por replaceTrack, ninguém cai da mesa.
      if (!noiseSuppressionIA || ctxPedidoParaIaRef.current || taxaServe(ctxAtual.sampleRate)) {
        gainNodeRef.current.gain.value = inputGain;
        sincronizarProcessamento();
        return;
      }
      desmontarGrafoDeAudio();
    }
    try {
      const AudioCtx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      // 48 kHz na marra só quando a IA está ligada: é a taxa em que o modelo
      // foi treinado. Pedir uma taxa diferente da placa faz o navegador
      // reamostrar, e esse custo não tem por que cair em quem está sem IA.
      let ctx: AudioContext;
      try {
        ctx = noiseSuppressionIA ? new AudioCtx({ sampleRate: TAXA_DO_MODELO }) : new AudioCtx();
      } catch {
        // Navegador que recusa a taxa pedida: abre no padrão dele e a ponte
        // decide, olhando a taxa que saiu, se dá para ligar a IA.
        ctx = new AudioCtx();
      }
      ctxPedidoParaIaRef.current = noiseSuppressionIA;
      const source = ctx.createMediaStreamSource(cru);
      const gain = ctx.createGain();
      gain.gain.value = inputGain;
      const meio = ctx.createGain();
      const destino = ctx.createMediaStreamDestination();
      source.connect(gain);
      gain.connect(meio);
      meio.connect(destino);

      // Fora de um gesto do usuário o contexto nasce suspenso, e contexto
      // suspenso não gera amostras: silêncio total para a mesa. No iOS ele
      // também é suspenso ao bloquear a tela e não volta sozinho.
      void ctx.resume().catch(() => undefined);
      ctx.onstatechange = () => {
        if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
      };

      gainCtxRef.current = ctx;
      gainNodeRef.current = gain;
      destinoRef.current = destino;
      ponteDoSupressorRef.current = ponteDeSupressor(ctx, gain, meio);
      ponteDoGateRef.current = ponteDeGate(ctx, meio, destino);
      // A faixa já vai ao ar sem esperar o modelo baixar: os processadores
      // entram no meio do grafo depois, e o destino — logo, a faixa publicada —
      // é o mesmo antes e depois.
      publicarFaixaDeAudio(destino.stream);
      sincronizarProcessamento();
    } catch {
      // Sem Web Audio a mesa continua na faixa crua; só o slider fica sem efeito.
      gainCtxRef.current = null;
      gainNodeRef.current = null;
      destinoRef.current = null;
      ponteDoSupressorRef.current = null;
      ponteDoGateRef.current = null;
    }
  }, [desmontarGrafoDeAudio, publicarFaixaDeAudio, sincronizarProcessamento]);

  /**
   * Reabre o microfone com as constraints atuais e bota a faixa nova no ar.
   * Só é usado quando o navegador não aceita trocar um filtro na faixa aberta.
   */
  const recapturarMicrofone = useCallback(async () => {
    let novo: MediaStream;
    try {
      novo = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints(prefsRef.current),
      });
    } catch {
      // Trocar uma faixa que funciona por nenhuma seria pior que ignorar a
      // preferência: fica com a atual.
      return;
    }
    const antigo = micRawRef.current;
    micRawRef.current = novo;
    aplicarMudo(novo);
    // replaceTrack por baixo dos panos: ninguém cai da mesa e não há renegociação.
    if (gainNodeRef.current) {
      desmontarGrafoDeAudio();
      montarGrafoDeAudio();
    } else {
      publicarFaixaDeAudio(novo);
    }
    antigo?.getTracks().forEach((t) => t.stop());
  }, [aplicarMudo, desmontarGrafoDeAudio, montarGrafoDeAudio, publicarFaixaDeAudio]);

  /**
   * `createPeer` por ref: a recuperação precisa RECRIAR o peer, e recriar é
   * chamar `createPeer` de dentro de um handler que o próprio `createPeer`
   * instalou. A ref quebra o ciclo sem congelar uma versão velha do callback.
   */
  const createPeerRef = useRef<((remoteId: string, polite: boolean) => PeerBox) | null>(null);

  const cancelarVolta = useCallback((box: PeerBox) => {
    if (box.timerDeVolta === null) return;
    window.clearTimeout(box.timerDeVolta);
    box.timerDeVolta = null;
  }, []);

  /**
   * Quem oferece é sempre o mesmo lado, e é o mesmo critério do `createPeer`:
   * o id menor é o impolido, e é ele quem reinicia o ICE. Os dois lados
   * reiniciarem ao mesmo tempo é uma colisão de ofertas — a que já nos custou
   * a tela preta com duas transmissões. O lado polido espera; se o impolido
   * tiver sumido de vez, a conexão cai para `failed` e aí os dois recriam.
   */
  const souImpolido = useCallback((remoteId: string) => !!userId && userId < remoteId, [userId]);

  /**
   * Recria a conexão do zero, preservando o meu lugar na mesa.
   *
   * Isto NÃO pode depender do presence sync. Era essa a dependência escondida
   * que fazia a transmissão só voltar quando quem transmitia fechava e reabria
   * o app: fechar e reabrir é um leave + join, e o sync que ele dispara era o
   * único lugar que recriava peers. Sem ninguém entrando ou saindo, o peer
   * deletado ficava deletado para sempre.
   *
   * O stream remoto é jogado fora junto, de propósito — ao contrário de parar
   * de assistir, onde a identidade dele é sagrada. Um `MediaStreamAudioSource`
   * fica preso à faixa que existia quando ele nasceu e não segue troca de
   * faixa; com um peer novo, as faixas são outras, e reaproveitar o stream
   * deixaria a pessoa muda para sempre. `saidaDeAudio.conectar` já sabe refazer
   * o ramo preservando o volume que eu tinha escolhido para ela.
   */
  const recriarPeer = useCallback(
    (remoteId: string) => {
      const antigo = peersRef.current.get(remoteId);
      if (antigo) {
        cancelarVolta(antigo);
        // Sem isto, o `onconnectionstatechange` do pc que está sendo fechado
        // dispara com "closed" e agenda uma recuperação para um peer morto.
        antigo.pc.onconnectionstatechange = null;
        antigo.pc.oniceconnectionstatechange = null;
        antigo.pc.onnegotiationneeded = null;
        antigo.pc.onsignalingstatechange = null;
        antigo.pc.onicecandidate = null;
        antigo.pc.ontrack = null;
        antigo.pc.close();
      }
      peersRef.current.delete(remoteId);
      remoteStreamsRef.current.delete(remoteId);
      publish();

      const novo = createPeerRef.current?.(remoteId, !souImpolido(remoteId));
      if (novo) novo.tentativas = (antigo?.tentativas ?? 0) + 1;
      // Quem já queria o meu vídeo continua querendo: a presença não mudou, só
      // a conexão. Sem isto, a transmissão voltaria preta até o próximo sync.
      aplicarVideoNosPeers();
      return novo;
    },
    [aplicarVideoNosPeers, cancelarVolta, publish, souImpolido],
  );

  /**
   * Agenda a próxima tentativa de volta, com backoff. Reagenda sozinha até a
   * conexão voltar a `connected` — quem cancela é o handler de estado.
   */
  const agendarVolta = useCallback(
    (box: PeerBox, remoteId: string) => {
      if (box.timerDeVolta !== null) return;
      const espera = Math.min(BACKOFF_TETO_MS, BACKOFF_BASE_MS * 2 ** box.tentativas);
      box.timerDeVolta = window.setTimeout(() => {
        box.timerDeVolta = null;
        // O box pode ter sido substituído por um `recriarPeer` no meio do
        // caminho; o timer velho não manda em conexão nova.
        if (peersRef.current.get(remoteId) !== box) return;
        const estado = box.pc.connectionState;
        if (estado === "connected" || estado === "closed") return;

        if (estado === "failed") {
          recriarPeer(remoteId);
          return;
        }
        box.tentativas += 1;
        if (souImpolido(remoteId)) {
          try {
            // Dispara onnegotiationneeded, e a oferta que sai já vai com
            // ice-restart. Quem renegocia é o `negociar` de sempre.
            box.pc.restartIce();
          } catch {
            // Navegador sem restartIce: não dá para consertar de leve, então
            // deixa a conexão seguir para `failed` e recriar por inteiro.
          }
        }
        agendarVolta(box, remoteId);
      }, espera);
    },
    [recriarPeer, souImpolido],
  );

  const createPeer = useCallback(
    (remoteId: string, polite: boolean) => {
      const existing = peersRef.current.get(remoteId);
      if (existing) return existing;

      const pc = new RTCPeerConnection(ICE_SERVERS);
      const box: PeerBox = {
        pc,
        polite,
        makingOffer: false,
        ignoreOffer: false,
        audioSender: null,
        videoSender: null,
        videoAtual: null,
        renegociarPendente: false,
        tentativas: 0,
        timerDeVolta: null,
      };
      peersRef.current.set(remoteId, box);

      const aTrack = micStreamRef.current?.getAudioTracks()[0];
      if (aTrack && micStreamRef.current) {
        box.audioSender = pc.addTrack(aTrack, micStreamRef.current);
      }
      // O transceiver de vídeo nasce com o peer, mesmo sem ninguém transmitindo:
      // é o que permite começar e parar depois sem renegociar nada. Nasce VAZIO
      // mesmo que eu já esteja transmitindo — quem chega não recebe vídeo até
      // pedir. Quem pedir entra por `aplicarVideoNosPeers`, na sincronização de
      // presença que vem logo em seguida.
      try {
        const transceiver = pc.addTransceiver("video", { direction: "sendonly" });
        box.videoSender = transceiver.sender;
      } catch {
        // Navegador sem addTransceiver: o sender nasce lá no aplicarVideoNosPeers,
        // por addTrack, quando alguém pedir de fato.
      }

      pc.onicecandidate = (e) => {
        if (e.candidate && userId)
          send({ from: userId, to: remoteId, candidate: e.candidate.toJSON() });
      };

      const negociar = async () => {
        if (!userId) return;
        try {
          box.makingOffer = true;
          await pc.setLocalDescription();
          if (pc.localDescription)
            send({ from: userId, to: remoteId, description: pc.localDescription.toJSON() });
          box.renegociarPendente = false;
        } catch {
          // Estado instável no meio de uma colisão de ofertas. Guardar para
          // refazer quando estabilizar; engolir aqui era o que deixava a linha
          // de vídeo sem negociar para sempre — a tela preta com dois
          // transmitindo ao mesmo tempo.
          box.renegociarPendente = true;
        } finally {
          box.makingOffer = false;
        }
      };

      pc.onnegotiationneeded = () => void negociar();

      pc.onsignalingstatechange = () => {
        if (pc.signalingState === "stable" && box.renegociarPendente) void negociar();
      };

      pc.ontrack = (e) => {
        // Vídeo que eu não pedi não entra no stream. Ele CHEGA de qualquer
        // jeito — o transceiver nasce com o peer —, mas ficar de fora até eu
        // pedir é o que mantém a lista de faixas honesta.
        if (e.track.kind === "video" && !assistindoRef.current.includes(remoteId)) return;
        armarFaixa(remoteId, e.track);
      };

      /**
       * Três estados, três respostas diferentes — e nenhuma delas é apagar o
       * peer e esperar. `disconnected` é soluço e se resolve com ICE novo;
       * `failed` é rota perdida e pede conexão nova; `connected` é a hora de
       * esquecer que houve problema.
       */
      const aoMudarEstado = () => {
        // Um pc que já foi substituído não manda mais em nada.
        if (peersRef.current.get(remoteId) !== box) return;
        switch (pc.connectionState) {
          case "connected":
            cancelarVolta(box);
            box.tentativas = 0;
            // Agora sim há camada de codificação para limitar: antes da
            // negociação `getParameters` costuma vir sem nenhuma, e a tentativa
            // lá do `aplicarVideoNosPeers` desistiu no meio.
            aplicarTetoDeBitrate(box);
            // Peer novo, receivers novos: se eu já estava assistindo antes da
            // queda, a faixa que voltou está aqui e ninguém mais a prenderia.
            repescarVideo(remoteId);
            publish();
            break;
          case "disconnected":
            // Recuperável: quase sempre volta sozinho antes do primeiro timer.
            agendarVolta(box, remoteId);
            break;
          case "failed":
            // Não espera o backoff da primeira vez: `failed` já é o fim da
            // linha do ICE, e a reconstrução é o único caminho de volta.
            cancelarVolta(box);
            recriarPeer(remoteId);
            break;
          case "closed":
            cancelarVolta(box);
            break;
        }
      };

      pc.onconnectionstatechange = aoMudarEstado;
      /**
       * O mesmo tratamento pela porta do ICE. Não é redundância: o Safari e o
       * Firefox demoram (ou deixam de) mover `connectionState`, e é o
       * `iceConnectionState` que muda primeiro. Como as duas rotas passam pelo
       * mesmo lugar e `agendarVolta` ignora agendamento em dobro, chegar pelas
       * duas não faz nada além de chegar mais cedo.
       */
      pc.oniceconnectionstatechange = () => {
        if (peersRef.current.get(remoteId) !== box) return;
        const estado = pc.iceConnectionState;
        if (estado === "connected" || estado === "completed") {
          cancelarVolta(box);
          box.tentativas = 0;
          // Mesma repesca pela porta do ICE: no Safari e no Firefox é por aqui
          // que a volta é percebida, e às vezes só por aqui.
          repescarVideo(remoteId);
        } else if (estado === "disconnected") {
          agendarVolta(box, remoteId);
        } else if (estado === "failed") {
          cancelarVolta(box);
          recriarPeer(remoteId);
        }
      };

      return box;
    },
    [
      agendarVolta,
      aplicarTetoDeBitrate,
      armarFaixa,
      cancelarVolta,
      publish,
      recriarPeer,
      repescarVideo,
      send,
      userId,
    ],
  );

  // Fecha o ciclo: `recriarPeer` chama `createPeer` por aqui.
  createPeerRef.current = createPeer;

  const dropPeer = useCallback(
    (remoteId: string) => {
      const box = peersRef.current.get(remoteId);
      if (box) {
        cancelarVolta(box);
        // A pessoa saiu da mesa: o "closed" que vem do close() não pode
        // agendar uma volta para quem não está mais aqui.
        box.pc.onconnectionstatechange = null;
        box.pc.oniceconnectionstatechange = null;
        box.pc.close();
      }
      peersRef.current.delete(remoteId);
      remoteStreamsRef.current.delete(remoteId);
      publish();
    },
    [cancelarVolta, publish],
  );

  // ---- join / leave -------------------------------------------------------
  useEffect(() => {
    if (!channelId || !userId) return;
    let cancelled = false;

    const start = async () => {
      try {
        const cru = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints(prefsRef.current),
        });
        micRawRef.current = cru;
        micStreamRef.current = cru;
        aplicarMudo(cru);

        // O grafo é opcional e só entra se a pessoa tiver mexido no slider,
        // ligado o gate ou ligado a IA. Sem nenhum dos três, a mesa recebe
        // exatamente a faixa que o navegador capturou.
        const p = prefsRef.current;
        if (precisaDeGrafo(p.inputGain, p.noiseGate, p.noiseSuppressionIA)) montarGrafoDeAudio();
      } catch {
        setError("Não consegui acessar o microfone. Você entrou apenas como ouvinte.");
        micRawRef.current = null;
        micStreamRef.current = null;
      }
      setMicStreamState(micStreamRef.current);
      if (cancelled) return;

      const chan = supabase.channel(`voice:${channelId}`, {
        config: { presence: { key: userId }, broadcast: { self: false } },
      });
      chanRef.current = chan;

      chan.on("presence", { event: "sync" }, () => {
        const state = chan.presenceState<PresencaDeVoz>();
        const todos = Object.keys(state);
        // Você primeiro, sempre: a ordem das chaves da presença é a ordem em que
        // as pessoas chegaram, e ver a própria tampinha pulando de lugar quando
        // alguém entra é estranho.
        setParticipants([userId, ...todos.filter((id) => id !== userId)]);
        // Quem transmite o quê, e quem quer o MEU vídeo. Os dois saem da mesma
        // varredura porque saem da mesma presença.
        const transmitindo: Record<string, Transmissao> = {};
        const estados: Record<string, EstadoDeAudio> = {};
        const querem = new Set<string>();
        for (const [id, entradas] of Object.entries(state)) {
          if (id === userId) continue;
          // Uma pessoa pode ter mais de uma conexão sob a mesma chave; a última
          // é a que vale.
          const p = entradas[entradas.length - 1];
          if (!p) continue;
          if (p.video === "camera" || p.video === "screen") transmitindo[id] = p.video;
          if (p.assistindo?.includes(userId)) querem.add(id);
          // `=== true` e não `!!`: quem está numa versão anterior do app não
          // publica estes campos, e ausência tem que virar "não sei", que é o
          // mesmo que "sem indicador" — nunca um mudo inventado na tampinha.
          estados[id] = { micOff: p.micOff === true, deafened: p.deafened === true };
        }
        quemQuerMeuVideoRef.current = querem;
        setTransmissoes(transmitindo);
        setEstadosDeAudio(estados);
        // Quem parou de transmitir (ou saiu) some da minha lista sozinho, senão
        // eu ficaria pedindo para sempre um vídeo que não existe mais.
        setAssistindo((prev) => {
          const proximo = prev.filter((id) => transmitindo[id]);
          if (proximo.length === prev.length) return prev;
          // Mesma desmontagem do botão, pelo outro motivo: quem parou de
          // transmitir (ou saiu) tem a faixa solta aqui também. Sem isto o
          // quadro fica congelado esperando um `onended` que não vem.
          assistindoRef.current = proximo;
          prev.filter((id) => !transmitindo[id]).forEach(soltarVideoRecebido);
          return proximo;
        });

        const ids = todos.filter((id) => id !== userId);
        ids.forEach((id) => {
          if (!peersRef.current.has(id)) {
            // deterministic roles: lower id is the impolite initiator
            const initiator = userId < id;
            // O transceiver criado dentro de createPeer já dispara
            // onnegotiationneeded em quem inicia; um createOffer solto aqui não
            // mandava nada e só confundia.
            createPeer(id, !initiator);
          }
        });
        Array.from(peersRef.current.keys()).forEach((id) => {
          if (!ids.includes(id)) dropPeer(id);
        });
        // Por último, com os peers já criados: quem passou a querer o meu vídeo
        // recebe a faixa, quem desistiu recebe `null`. É idempotente, então
        // rodar a cada sincronização é justamente o que conserta um pedido que
        // se perdeu no caminho.
        aplicarVideoNosPeers();
      });

      chan.on("broadcast", { event: "signal" }, async ({ payload }) => {
        const msg = payload as SignalPayload;
        if (msg.to !== userId) return;
        let box = peersRef.current.get(msg.from);
        // Peer morto do meu lado, oferta chegando do outro: quem detectou a
        // queda primeiro já se reconstruiu e está oferecendo. Aplicar isso numa
        // conexão em `failed` só produz erro de estado — e é o caso comum,
        // porque nem sempre os dois lados percebem a queda ao mesmo tempo.
        if (box && (box.pc.connectionState === "failed" || box.pc.connectionState === "closed")) {
          box = recriarPeer(msg.from);
        }
        if (!box) box = createPeer(msg.from, userId > msg.from);
        const { pc } = box;
        try {
          if (msg.description) {
            const offerCollision =
              msg.description.type === "offer" &&
              (box.makingOffer || pc.signalingState !== "stable");
            box.ignoreOffer = !box.polite && offerCollision;
            if (box.ignoreOffer) return;
            await pc.setRemoteDescription(msg.description);
            if (msg.description.type === "offer") {
              await pc.setLocalDescription();
              if (pc.localDescription) {
                send({ from: userId, to: msg.from, description: pc.localDescription.toJSON() });
              }
            }
          } else if (msg.candidate) {
            try {
              await pc.addIceCandidate(msg.candidate);
            } catch {
              if (!box.ignoreOffer) throw new Error("ice");
            }
          }
        } catch {
          /* ignore transient signaling errors */
        }
      });

      chan.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          entradaRef.current = Date.now();
          publicarPresenca();
          setConnected(true);
        }
      });
    };

    void start();

    return () => {
      cancelled = true;
      setConnected(false);
      // O setter cru, e não o `setMicOn` daqui de baixo: este é o desmonte da
      // sala, não há mais presença para publicar nem faixa para reabrir.
      setMicOnState(true);
      micOnRef.current = true;
      peersRef.current.forEach((b) => {
        if (b.timerDeVolta !== null) window.clearTimeout(b.timerDeVolta);
        b.timerDeVolta = null;
        b.pc.onconnectionstatechange = null;
        b.pc.oniceconnectionstatechange = null;
        b.pc.close();
      });
      peersRef.current.clear();
      remoteStreamsRef.current.clear();
      setRemotePeers([]);
      setParticipants([]);
      setTransmissoes({});
      setEstadosDeAudio({});
      setAssistindo([]);
      assistindoRef.current = [];
      quemQuerMeuVideoRef.current = new Set();
      // Com o grafo montado a faixa publicada é outra que não a crua; parar só
      // uma das duas deixaria o microfone aberto. Parar as duas é seguro porque
      // stop() numa faixa já parada não faz nada.
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      micRawRef.current?.getTracks().forEach((t) => t.stop());
      micRawRef.current = null;
      ponteDoSupressorRef.current?.destruir();
      ponteDoSupressorRef.current = null;
      ponteDoGateRef.current?.destruir();
      ponteDoGateRef.current = null;
      destinoRef.current = null;
      void gainCtxRef.current?.close().catch(() => undefined);
      gainCtxRef.current = null;
      gainNodeRef.current = null;
      setMicStreamState(null);
      videoStreamRef.current?.getTracks().forEach((t) => t.stop());
      videoStreamRef.current = null;
      setLocalVideoStream(null);
      setVideoMode("none");
      if (chanRef.current) void supabase.removeChannel(chanRef.current);
      chanRef.current = null;
    };
  }, [
    channelId,
    userId,
    createPeer,
    dropPeer,
    send,
    aplicarMudo,
    montarGrafoDeAudio,
    aplicarVideoNosPeers,
    publicarPresenca,
    soltarVideoRecebido,
    recriarPeer,
  ]);

  // O que eu transmito e o que eu quero assistir são estado, e estado vive na
  // presença. Republicar é o que faz o outro lado começar (ou parar) de mandar.
  useEffect(() => {
    videoModeRef.current = videoMode;
    publicarPresenca();
  }, [videoMode, assistindo, publicarPresenca]);

  // ---- controls -----------------------------------------------------------
  // Mexer no slider, no gate ou na IA vale na hora, sem sair e voltar para a
  // mesa. Slider em 100% com os dois desligados desmonta o grafo e devolve a
  // faixa crua — é o caminho que soa melhor, e é a saída imediata se algum dos
  // dois atrapalhar.
  useEffect(() => {
    if (!micRawRef.current) return;
    if (precisaDeGrafo(prefs.inputGain, prefs.noiseGate, prefs.noiseSuppressionIA))
      montarGrafoDeAudio();
    else desmontarGrafoDeAudio();
  }, [
    prefs.inputGain,
    prefs.noiseGate,
    prefs.noiseGateThreshold,
    prefs.noiseSuppressionIA,
    montarGrafoDeAudio,
    desmontarGrafoDeAudio,
  ]);

  // Filtros do navegador ao vivo. O caminho barato é applyConstraints na faixa
  // já aberta; o Chrome costuma aceitar a chamada sem trocar nada de fato, então
  // conferimos o resultado em getSettings e só reabrimos o microfone se preciso.
  useEffect(() => {
    const faixa = micRawRef.current?.getAudioTracks()[0];
    if (!faixa) return;
    let cancelado = false;
    const alvo = filtrosDeAudio(prefsRef.current);

    void (async () => {
      try {
        await faixa.applyConstraints(alvo);
      } catch {
        // Recusou de cara: cai direto para a recaptura.
      }
      if (cancelado) return;
      const agora = faixa.getSettings();
      // Campo que o navegador não reporta não conta como divergência, senão
      // entraríamos em recaptura eterna num browser que só omite a informação.
      const pegou = (Object.keys(alvo) as (keyof typeof alvo)[]).every(
        (k) => agora[k] === undefined || agora[k] === alvo[k],
      );
      if (!pegou) await recapturarMicrofone();
    })();

    return () => {
      cancelado = true;
    };
  }, [prefs.echoCancellation, prefs.noiseSuppression, prefs.autoGainControl, recapturarMicrofone]);

  /**
   * Abre e fecha o microfone na própria faixa. `enabled = false` e nada mais:
   * tirar a faixa ou trocá-la por `null` obrigaria a renegociar com todo mundo
   * na malha, e o outro lado veria a pessoa "sair" e "voltar" a cada mudo.
   * Com `enabled` a faixa continua de pé mandando silêncio, ninguém renegocia,
   * e o sinal de que estou mudo vai pela presença — que é onde estado mora.
   */
  const setMicOn = useCallback(
    (ligado: boolean) => {
      if (micOnRef.current === ligado) return;
      micOnRef.current = ligado;
      micStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = ligado));
      setMicOnState(ligado);
      publicarPresenca();
    },
    [publicarPresenca],
  );

  const toggleMic = useCallback(() => setMicOn(!micOnRef.current), [setMicOn]);

  // O fone mudo é decidido lá em cima, no provider, mas quem publica presença é
  // aqui. Republicar quando ele muda é o que acende o indicador nos outros.
  useEffect(() => {
    if (deafenedRef.current === deafened) return;
    deafenedRef.current = deafened;
    publicarPresenca();
  }, [deafened, publicarPresenca]);

  const stopVideo = useCallback(() => {
    videoStreamRef.current?.getTracks().forEach((t) => t.stop());
    videoStreamRef.current = null;
    setLocalVideoStream(null);
    setVideoMode("none");
    // O ref anda na frente do estado: quem lê o modo é o `aplicar` logo abaixo,
    // ainda neste tique, e o efeito que sincroniza o ref só roda depois.
    videoModeRef.current = "none";
    // replaceTrack(null) e não removeTrack: o sender continua de pé, ninguém
    // renegocia, e do outro lado a faixa fica muda na hora — que é o sinal que
    // o publish() agora lê para tirar o tile da tela. Com videoStreamRef já
    // nulo, o aplicar manda `null` para todo mundo.
    aplicarVideoNosPeers();
  }, [aplicarVideoNosPeers]);

  const startVideo = useCallback(
    async (mode: "camera" | "screen") => {
      setError(null);
      try {
        const stream =
          mode === "screen"
            ? await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: 30 },
                audio: true,
              })
            : await navigator.mediaDevices.getUserMedia({
                video: videoConstraints(prefsRef.current),
              });

        videoStreamRef.current?.getTracks().forEach((t) => t.stop());
        videoStreamRef.current = stream;
        setLocalVideoStream(stream);
        setVideoMode(mode);
        // Mesma razão do stopVideo: o teto de banda depende de saber se isto é
        // tela ou câmera, e quem decide isso é o ref, não o estado.
        videoModeRef.current = mode;

        const track = stream.getVideoTracks()[0];
        if (track) track.onended = () => stopVideo();
        // Começar a transmitir NÃO empurra vídeo para ninguém: só sai para quem
        // já tinha pedido. Os outros veem o convite no painel e decidem.
        aplicarVideoNosPeers();
      } catch {
        setError(
          mode === "screen"
            ? "Compartilhamento de tela cancelado ou bloqueado pelo navegador."
            : "Não consegui acessar a câmera.",
        );
      }
    },
    [stopVideo, aplicarVideoNosPeers],
  );

  return {
    connected,
    micOn,
    micStream,
    toggleMic,
    setMicOn,
    estadosDeAudio,
    remotePeers,
    localVideoStream,
    videoMode,
    startVideo,
    stopVideo,
    error,
    participants,
    transmissoes,
    assistindo,
    assistir,
    pararDeAssistir,
    // O `|| 1` cobre a janela entre entrar e a primeira sincronização da
    // presença chegar: nesse instante você já está na mesa, só ainda não se viu.
    participantCount: participants.length || 1,
  };
}
