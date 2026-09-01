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
import type { RealtimeChannel } from "@supabase/supabase-js";

export type RemotePeer = {
  userId: string;
  stream: MediaStream;
  hasVideo: boolean;
};

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
  /** Negociação que falhou por estado instável e precisa ser refeita. */
  renegociarPendente: boolean;
};

/**
 * Passar o áudio por Web Audio custa: a faixa deixa de ser a que o navegador
 * capturou. Só vale a pena quando há o que fazer com ela.
 */
function precisaDeGrafo(inputGain: number, noiseGate: boolean) {
  return inputGain !== 1 || noiseGate;
}

/**
 * WebRTC mesh room. Signaling rides on a Realtime broadcast channel.
 * Presence tells us who is in the room.
 */
export function useVoiceRoom(
  channelId: string | null,
  userId: string | null,
  prefs: MediaPrefs = MEDIA_PREFS_PADRAO,
) {
  const [connected, setConnected] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [micStream, setMicStreamState] = useState<MediaStream | null>(null);
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);
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
  /** Gate de ruído opcional entre o ganho e o destino. */
  const ponteDoGateRef = useRef<PonteDeGate | null>(null);
  /** Espelho de micOn, para reaplicar o mudo quando a faixa publicada troca. */
  const micOnRef = useRef(true);

  // As prefs entram por ref: mudar o volume não pode reconectar a mesa inteira.
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());

  const publish = useCallback(() => {
    setRemotePeers(
      Array.from(remoteStreamsRef.current.entries()).map(([id, stream]) => ({
        userId: id,
        stream,
        // `muted` é o que separa uma transmissão viva de uma que o outro lado
        // já encerrou: removeTrack/replaceTrack(null) deixam a faixa remota
        // muda, mas com readyState ainda em "live". Olhar só o readyState era o
        // que mantinha o último quadro congelado na tela.
        hasVideo: stream.getVideoTracks().some((t) => !t.muted && t.readyState === "live"),
      })),
    );
  }, []);

  const send = useCallback((payload: SignalPayload) => {
    void chanRef.current?.send({ type: "broadcast", event: "signal", payload });
  }, []);

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
   * Põe o gate no estado que as preferências pedem, dentro do grafo que já
   * existe. A faixa publicada não muda: quem sai do grafo é sempre o mesmo
   * destino, então ninguém na mesa percebe nada além do áudio mudar.
   */
  const sincronizarGate = useCallback(() => {
    const { noiseGate, noiseGateThreshold } = prefsRef.current;
    ponteDoGateRef.current?.sincronizar(noiseGate, noiseGateThreshold);
  }, []);

  /**
   * Só é montado quando a pessoa mexe no volume de entrada ou liga o gate.
   * Enquanto o slider está em 100% e o gate desligado, a mesa recebe a faixa
   * crua, sem nenhum processamento nosso.
   *
   * O grafo é `mic → ganho → [gate] → destino`. O gate fica DEPOIS do ganho de
   * propósito: assim o limiar vive na mesma escala do medidor do teste, e a
   * linha do limiar não passeia quando alguém mexe no volume de entrada.
   */
  const montarGrafoDeAudio = useCallback(() => {
    const cru = micRawRef.current;
    if (!cru) return;
    const ganho = prefsRef.current.inputGain;
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = ganho;
      sincronizarGate();
      return;
    }
    try {
      const AudioCtx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(cru);
      const gain = ctx.createGain();
      gain.gain.value = ganho;
      const destino = ctx.createMediaStreamDestination();
      source.connect(gain);
      gain.connect(destino);

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
      ponteDoGateRef.current = ponteDeGate(ctx, gain, destino);
      // A faixa já vai ao ar sem esperar o gate: o gate entra no meio do grafo
      // depois, e o destino — logo, a faixa publicada — é o mesmo antes e depois.
      publicarFaixaDeAudio(destino.stream);
      sincronizarGate();
    } catch {
      // Sem Web Audio a mesa continua na faixa crua; só o slider fica sem efeito.
      gainCtxRef.current = null;
      gainNodeRef.current = null;
      destinoRef.current = null;
      ponteDoGateRef.current = null;
    }
  }, [publicarFaixaDeAudio, sincronizarGate]);

  /** Volta a publicar a faixa crua e derruba o grafo. */
  const desmontarGrafoDeAudio = useCallback(() => {
    if (!gainCtxRef.current && !gainNodeRef.current) return;
    // Antes do close(): a ponte ainda mexe nas conexões ao se desfazer.
    ponteDoGateRef.current?.destruir();
    ponteDoGateRef.current = null;
    destinoRef.current = null;
    void gainCtxRef.current?.close().catch(() => undefined);
    gainCtxRef.current = null;
    gainNodeRef.current = null;
    publicarFaixaDeAudio(micRawRef.current);
  }, [publicarFaixaDeAudio]);

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
        renegociarPendente: false,
      };
      peersRef.current.set(remoteId, box);

      const aTrack = micStreamRef.current?.getAudioTracks()[0];
      if (aTrack && micStreamRef.current) {
        box.audioSender = pc.addTrack(aTrack, micStreamRef.current);
      }
      // O transceiver de vídeo nasce com o peer, mesmo sem ninguém transmitindo:
      // é o que permite começar e parar depois sem renegociar nada. Se já
      // houver transmissão em curso, ele já nasce com a faixa.
      const vTrack = videoStreamRef.current?.getVideoTracks()[0] ?? null;
      try {
        const transceiver = pc.addTransceiver(vTrack ?? "video", {
          direction: "sendonly",
          ...(videoStreamRef.current ? { streams: [videoStreamRef.current] } : {}),
        });
        box.videoSender = transceiver.sender;
      } catch {
        // Navegador sem addTransceiver: cai no caminho antigo, que renegocia.
        if (vTrack && videoStreamRef.current) {
          box.videoSender = pc.addTrack(vTrack, videoStreamRef.current);
        }
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
        let stream = remoteStreamsRef.current.get(remoteId);
        if (!stream) {
          stream = new MediaStream();
          remoteStreamsRef.current.set(remoteId, stream);
        }
        // Uma faixa de vídeo por pessoa. Sem isso, quem parava e voltava a
        // transmitir deixava a faixa morta no stream, e o <video> renderiza a
        // primeira — a congelada — em vez da nova.
        if (e.track.kind === "video") {
          stream.getVideoTracks().forEach((t) => {
            if (t.id !== e.track.id) stream!.removeTrack(t);
          });
        }
        if (!stream.getTracks().some((t) => t.id === e.track.id)) stream.addTrack(e.track);
        e.track.onended = () => {
          stream?.removeTrack(e.track);
          publish();
        };
        e.track.onmute = publish;
        e.track.onunmute = publish;
        publish();
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          pc.close();
          peersRef.current.delete(remoteId);
          remoteStreamsRef.current.delete(remoteId);
          publish();
        }
      };

      return box;
    },
    [publish, send, userId],
  );

  const dropPeer = useCallback(
    (remoteId: string) => {
      peersRef.current.get(remoteId)?.pc.close();
      peersRef.current.delete(remoteId);
      remoteStreamsRef.current.delete(remoteId);
      publish();
    },
    [publish],
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

        // O grafo é opcional e só entra se a pessoa tiver mexido no slider ou
        // ligado o gate. Sem nenhum dos dois, a mesa recebe exatamente a faixa
        // que o navegador capturou.
        const p = prefsRef.current;
        if (precisaDeGrafo(p.inputGain, p.noiseGate)) montarGrafoDeAudio();
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
        const state = chan.presenceState();
        const ids = Object.keys(state).filter((id) => id !== userId);
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
      });

      chan.on("broadcast", { event: "signal" }, async ({ payload }) => {
        const msg = payload as SignalPayload;
        if (msg.to !== userId) return;
        const box = peersRef.current.get(msg.from) ?? createPeer(msg.from, userId > msg.from);
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

      chan.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await chan.track({ userId, at: Date.now() });
          setConnected(true);
        }
      });
    };

    void start();

    return () => {
      cancelled = true;
      setConnected(false);
      setMicOn(true);
      micOnRef.current = true;
      peersRef.current.forEach((b) => b.pc.close());
      peersRef.current.clear();
      remoteStreamsRef.current.clear();
      setRemotePeers([]);
      // Com o grafo montado a faixa publicada é outra que não a crua; parar só
      // uma das duas deixaria o microfone aberto. Parar as duas é seguro porque
      // stop() numa faixa já parada não faz nada.
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      micRawRef.current?.getTracks().forEach((t) => t.stop());
      micRawRef.current = null;
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
  }, [channelId, userId, createPeer, dropPeer, send, aplicarMudo, montarGrafoDeAudio]);

  // ---- controls -----------------------------------------------------------
  // Mexer no slider ou no gate vale na hora, sem sair e voltar para a mesa.
  // Slider em 100% com o gate desligado desmonta o grafo e devolve a faixa crua
  // — é o caminho que soa melhor, e é a saída imediata se o gate atrapalhar.
  useEffect(() => {
    if (!micRawRef.current) return;
    if (precisaDeGrafo(prefs.inputGain, prefs.noiseGate)) montarGrafoDeAudio();
    else desmontarGrafoDeAudio();
  }, [
    prefs.inputGain,
    prefs.noiseGate,
    prefs.noiseGateThreshold,
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

  const toggleMic = useCallback(() => {
    const next = !micOn;
    micOnRef.current = next;
    micStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = next));
    setMicOn(next);
  }, [micOn]);

  const stopVideo = useCallback(() => {
    videoStreamRef.current?.getTracks().forEach((t) => t.stop());
    videoStreamRef.current = null;
    setLocalVideoStream(null);
    setVideoMode("none");
    // replaceTrack(null) e não removeTrack: o sender continua de pé, ninguém
    // renegocia, e do outro lado a faixa fica muda na hora — que é o sinal que
    // o publish() agora lê para tirar o tile da tela.
    peersRef.current.forEach((box) => {
      void box.videoSender?.replaceTrack(null).catch(() => undefined);
    });
  }, []);

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

        const track = stream.getVideoTracks()[0];
        if (track) {
          track.onended = () => stopVideo();
          peersRef.current.forEach((box) => {
            if (box.videoSender) void box.videoSender.replaceTrack(track).catch(() => undefined);
            // Só cai aqui num navegador sem addTransceiver, onde o sender não
            // pôde nascer junto com o peer.
            else box.videoSender = box.pc.addTrack(track, stream);
          });
        }
      } catch {
        setError(
          mode === "screen"
            ? "Compartilhamento de tela cancelado ou bloqueado pelo navegador."
            : "Não consegui acessar a câmera.",
        );
      }
    },
    [stopVideo],
  );

  return {
    connected,
    micOn,
    micStream,
    toggleMic,
    remotePeers,
    localVideoStream,
    videoMode,
    startVideo,
    stopVideo,
    error,
    participantCount: remotePeers.length + 1,
  };
}
