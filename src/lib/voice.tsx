import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  useVoiceRoom,
  type EstadoDeAudio,
  type RemotePeer,
  type Transmissao,
} from "@/hooks/useVoiceRoom";
import {
  useMediaPrefs,
  AUDIO_DO_PARTICIPANTE_PADRAO,
  type AudioDoParticipante,
} from "@/lib/mediaPrefs";
import {
  criarSaidaDeAudio,
  ganhoEfetivo,
  VOLUME_MAXIMO,
  type SaidaDeAudio,
} from "@/lib/saidaDeAudio";
import { useSpeaking } from "@/hooks/useSpeaking";
import { HEARTBEAT_MS, saidaComKeepalive } from "@/lib/voicePresence";

export type VoiceTarget = { channelId: string; channelName: string; serverId: string };

type VoiceContextValue = {
  active: VoiceTarget | null;
  connected: boolean;
  micOn: boolean;
  micStream: MediaStream | null;
  toggleMic: () => void;
  videoMode: "none" | "camera" | "screen";
  localVideoStream: MediaStream | null;
  remotePeers: RemotePeer[];
  /** Todo mundo na mesa, você incluído — inclusive quem entrou só de ouvinte. */
  participants: string[];
  /** Quem está transmitindo agora, e o quê. Estar aqui não faz nada carregar. */
  transmissoes: Record<string, Transmissao>;
  /** De quem você pediu para receber vídeo. */
  assistindo: string[];
  assistir: (userId: string) => void;
  pararDeAssistir: (userId: string) => void;
  speaking: Record<string, boolean>;
  participantCount: number;
  /** Microfone fechado / fone mudo de cada um dos OUTROS, vindo da presenca. */
  estadosDeAudio: Record<string, EstadoDeAudio>;
  /**
   * Volume e mudo de cada participante, do MEU ponto de vista. Nada aqui sai
   * da minha aba: mutar alguem nao avisa a pessoa nem afeta o resto da mesa.
   */
  peerAudio: Record<string, AudioDoParticipante>;
  /** 0 a 2. Acima de 1 amplifica e pode clipar - ver VOLUME_MAXIMO. */
  setPeerVolume: (userId: string, volume: number) => void;
  togglePeerMute: (userId: string) => void;
  /** Meu fone esta mudo: nao ouco ninguem, e o meu microfone vai junto. */
  deafened: boolean;
  toggleDeafen: () => void;
  busy: boolean;
  join: (target: VoiceTarget) => void;
  leave: () => void;
  toggleVideo: (mode: "camera" | "screen") => Promise<void>;
};

const VoiceContext = createContext<VoiceContextValue | null>(null);

/**
 * Prende um participante ao grafo de saída enquanto ele estiver na mesa.
 *
 * Não renderiza nada: o <audio> que o Chrome exige para a faixa fluir é criado
 * dentro de `saidaDeAudio`, junto com o resto do ramo, porque nasce e morre com
 * ele. Este componente existe só para amarrar o ciclo de vida do ramo ao ciclo
 * de vida do peer — é o React quem garante que o cleanup roda, inclusive quando
 * o peer cai sem avisar. Numa malha de quinze pessoas, um ramo vazado é um
 * stream remoto e dois AudioNodes que ninguém mais coleta.
 */
function RamoDoParticipante({
  peer,
  saida,
  ganho,
}: {
  peer: RemotePeer;
  saida: SaidaDeAudio | null;
  ganho: number;
}) {
  useEffect(() => {
    if (!saida) return;
    saida.conectar(peer.userId, peer.stream);
    return () => saida.desconectar(peer.userId);
  }, [saida, peer.userId, peer.stream]);

  // Roda depois do efeito acima, então o ramo já existe quando o ganho chega.
  // `peer.stream` entra nas dependências porque o efeito de cima pode ter
  // acabado de refazer o ramo, e um ramo novo nasce em 1.
  useEffect(() => {
    saida?.definirGanhoDoPeer(peer.userId, ganho);
  }, [saida, peer.userId, ganho, peer.stream]);

  return null;
}

/**
 * Sessão de voz global. Fica acima das rotas para que entrar numa mesa não dependa
 * de qual canal está na tela — só o "Sair da mesa" desconecta.
 */
export function VoiceProvider({ children }: { children: ReactNode }) {
  const { session, isAdult } = useAuth();
  const userId = session?.user.id ?? null;
  /**
   * O token entra por ref porque quem lê é o handler de fechamento da aba, que
   * não pode esperar um `getSession()` assíncrono: a página já está morrendo.
   */
  const accessTokenRef = useRef(session?.access_token ?? null);
  accessTokenRef.current = session?.access_token ?? null;
  /**
   * Batida de heartbeat ainda voando. A saída espera por ela antes de apagar a
   * presença: como a batida é um upsert, uma que chegue *depois* do apagamento
   * ressuscita a linha de quem acabou de sair — o fantasma na barra lateral.
   */
  const batidaEmVooRef = useRef<Promise<unknown> | null>(null);

  const [active, setActive] = useState<VoiceTarget | null>(null);
  const [busy, setBusy] = useState(false);

  const { prefs, setPrefs } = useMediaPrefs();
  /**
   * Fone mudo. Mora aqui e não nas prefs de propósito: é estado de sessão, não
   * preferência. Recarregar a página surdo, sem lembrar que foi você que
   * apertou o botão, é um jeito ruim de descobrir que a mesa não quebrou.
   */
  const [deafened, setDeafened] = useState(false);
  const room = useVoiceRoom(active?.channelId ?? null, userId, prefs, deafened);
  const activeChannelId = active?.channelId ?? null;

  /**
   * O grafo de saída. Um por sessão, criado com o provider e derrubado com ele:
   * recriar o AudioContext a cada troca de canal pediria um novo gesto do
   * usuário para destravá-lo, e navegador nenhum gosta de dezenas de contextos.
   */
  const [saida, setSaida] = useState<SaidaDeAudio | null>(null);
  useEffect(() => {
    const nova = criarSaidaDeAudio();
    setSaida(nova);
    return () => nova?.destruir();
  }, []);

  /**
   * Ganho mestre: o volume geral, zerado pelo fone mudo.
   *
   * O deafen vive AQUI, num nó só, e não num laço zerando o ganho de cada
   * pessoa. Um nó só significa que ele não tem como discordar do mudo
   * individual: desativar o deafen não ressuscita quem eu tinha mutado, e
   * mutar alguém não mexe no fone.
   */
  useEffect(() => {
    saida?.definirGanhoMestre(deafened ? 0 : prefs.outputVolume);
  }, [saida, deafened, prefs.outputVolume]);

  useEffect(() => {
    saida?.definirDispositivo(prefs.speakerId);
  }, [saida, prefs.speakerId]);

  // O contexto nasce suspenso até um gesto do usuário; entrar numa mesa é um.
  useEffect(() => {
    if (activeChannelId) saida?.retomar();
  }, [activeChannelId, saida]);

  // Sair junto com a sessão do usuário.
  useEffect(() => {
    if (!userId && active) setActive(null);
  }, [userId, active]);

  useEffect(() => {
    if (room.error) toast.error(room.error);
  }, [room.error]);

  // Linha de presença no banco — a regra de idade é validada lá também.
  useEffect(() => {
    if (!activeChannelId || !userId) return;
    let cancelled = false;

    void (async () => {
      // Uma pessoa ocupa uma mesa por vez. Limpar qualquer presença anterior antes
      // de entrar cura também fantasmas de abas fechadas sem cleanup.
      const { error: purgeError } = await supabase
        .from("voice_participants")
        .delete()
        .eq("user_id", userId)
        .neq("channel_id", activeChannelId);
      if (purgeError) console.error("Falha ao limpar presença de voz anterior", purgeError);
      if (cancelled) return;

      const { error } = await supabase
        .from("voice_participants")
        .upsert(
          { channel_id: activeChannelId, user_id: userId, camera_on: false, screen_sharing: false },
          { onConflict: "channel_id,user_id" },
        );
      if (error) console.error("Falha ao registrar presença na mesa de voz", error);
    })();

    return () => {
      cancelled = true;
      const apagar = () =>
        supabase
          .from("voice_participants")
          .delete()
          .eq("channel_id", activeChannelId)
          .eq("user_id", userId)
          .then(({ error }) => {
            if (error) console.error("Falha ao remover presença da mesa de voz", error);
          });

      // Sem a espera, uma batida em voo pode ser commitada depois do apagamento
      // e recriar a linha. Esperar dá a última palavra a quem está saindo.
      const emVoo = batidaEmVooRef.current;
      if (emVoo) void emVoo.catch(() => undefined).then(apagar);
      else void apagar();
    };
  }, [activeChannelId, userId]);

  // Camada 2: batida periódica que mantém a presença viva e, de carona, varre
  // os fantasmas de todo mundo. Ver src/lib/voicePresence.ts.
  useEffect(() => {
    if (!activeChannelId || !userId) return;
    let cancelled = false;

    const bater = () => {
      if (cancelled) return;
      // Promise.resolve porque o builder do supabase-js é só um thenable, e a
      // saída precisa de um Promise de verdade para encadear.
      const batida = Promise.resolve(
        supabase.rpc("voice_heartbeat", { _channel_id: activeChannelId }).then(({ error }) => {
          if (error) console.error("Falha no heartbeat da mesa de voz", error);
        }),
      );
      batidaEmVooRef.current = batida;
      void batida.finally(() => {
        // Só limpa se ninguém mais novo tomou o lugar.
        if (batidaEmVooRef.current === batida) batidaEmVooRef.current = null;
      });
    };

    bater();
    const timer = window.setInterval(bater, HEARTBEAT_MS);

    // Timer de aba oculta chega atrasado; ao voltar para a frente, bate na hora
    // para não ficar pendurado num beat velho. `pageshow` cobre a volta do
    // bfcache (o "voltar" do celular), em que a saída já foi enviada.
    const aoVoltar = () => {
      if (document.visibilityState === "visible") bater();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("pageshow", bater);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("pageshow", bater);
    };
  }, [activeChannelId, userId]);

  // Camada 1: aba fechando (X, recarregar, navegar para fora). Sai na hora, em
  // vez de deixar a expiração levar 150s para perceber.
  //
  // `visibilitychange -> hidden` NÃO entra aqui de propósito: minimizar a janela
  // para jogar é o uso normal do app, não uma saída.
  useEffect(() => {
    if (!activeChannelId || !userId) return;

    let jaSaiu = false;
    const sair = () => {
      if (jaSaiu) return;
      jaSaiu = true;
      const token = accessTokenRef.current;
      if (token) saidaComKeepalive(activeChannelId, userId, token);
    };
    // Restaurada do bfcache: a saída já foi mandada, mas a pessoa continua na
    // mesa. Libera o gatilho e deixa o heartbeat recolocá-la.
    const aoRestaurar = (e: PageTransitionEvent) => {
      if (e.persisted) jaSaiu = false;
    };

    // pagehide é o único confiável no Safari/iOS; beforeunload é o reforço no
    // desktop. Os dois disparando é inofensivo, o segundo vira no-op.
    window.addEventListener("pagehide", sair);
    window.addEventListener("beforeunload", sair);
    window.addEventListener("pageshow", aoRestaurar);

    return () => {
      window.removeEventListener("pagehide", sair);
      window.removeEventListener("beforeunload", sair);
      window.removeEventListener("pageshow", aoRestaurar);
    };
  }, [activeChannelId, userId]);

  const speaking = useSpeaking([
    ...(userId && room.micOn ? [{ id: userId, stream: room.micStream }] : []),
    ...room.remotePeers.map((p) => ({ id: p.userId, stream: p.stream })),
  ]);

  const join = useCallback((target: VoiceTarget) => {
    setActive((prev) => (prev?.channelId === target.channelId ? prev : target));
  }, []);

  const leave = useCallback(() => setActive(null), []);

  const setPeerVolume = useCallback(
    (peerId: string, volume: number) => {
      const v = Math.min(VOLUME_MAXIMO, Math.max(0, volume));
      // Arrastar o slider desmuta: pedir volume e continuar sem ouvir seria um
      // controle que mente. Arrastar até 0 é o mudo, e continua sendo.
      setPrefs((atual) => ({
        peerAudio: { ...atual.peerAudio, [peerId]: { volume: v, muted: false } },
      }));
    },
    [setPrefs],
  );

  const togglePeerMute = useCallback(
    (peerId: string) => {
      setPrefs((atual) => {
        const antes = atual.peerAudio[peerId] ?? AUDIO_DO_PARTICIPANTE_PADRAO;
        // Desmutar quem estava em 0 não pode devolver silêncio: sem volume para
        // onde voltar, volta para 100%.
        const volume = antes.muted && antes.volume === 0 ? 1 : antes.volume;
        return { peerAudio: { ...atual.peerAudio, [peerId]: { volume, muted: !antes.muted } } };
      });
    },
    [setPrefs],
  );

  /**
   * Fone mudo, no padrão do Discord: mutar o fone muta também o microfone —
   * ninguém quer falar sozinho para uma mesa que não está ouvindo de volta.
   *
   * O detalhe que faz a diferença é a memória: se eu já estava com o microfone
   * fechado ANTES de ficar surdo, desativar o deafen não pode reabrir o
   * microfone. Sem isso, todo deafen vira um jeito acidental de voltar falando.
   */
  const micAntesDoDeafenRef = useRef(true);
  const deafenedRef = useRef(false);
  deafenedRef.current = deafened;

  const toggleDeafen = useCallback(() => {
    const agora = !deafenedRef.current;
    if (agora) {
      micAntesDoDeafenRef.current = room.micOn;
      room.setMicOn(false);
    } else if (micAntesDoDeafenRef.current) {
      room.setMicOn(true);
    }
    setDeafened(agora);
  }, [room]);

  /**
   * Reabrir o microfone com o fone mudo tira o fone do mudo. É o que o Discord
   * faz, e é o que evita o beco sem saída: sem isto, quem aperta "desmutar"
   * enquanto surdo volta a falar para uma mesa que continua sem ouvir.
   */
  const toggleMic = useCallback(() => {
    if (deafenedRef.current && !room.micOn) {
      micAntesDoDeafenRef.current = true;
      setDeafened(false);
      room.setMicOn(true);
      return;
    }
    room.toggleMic();
  }, [room]);

  const toggleVideo = useCallback(
    async (mode: "camera" | "screen") => {
      if (!activeChannelId || !userId) return;
      if (!isAdult) {
        toast.error("Câmera e compartilhamento de tela são liberados apenas a partir dos 18 anos.");
        return;
      }
      setBusy(true);
      try {
        const setFlags = async (camera: boolean, screen: boolean) => {
          const { error } = await supabase
            .from("voice_participants")
            .update({ camera_on: camera, screen_sharing: screen })
            .eq("channel_id", activeChannelId)
            .eq("user_id", userId);
          return !error;
        };

        if (room.videoMode === mode) {
          await setFlags(false, false);
          room.stopVideo();
          return;
        }
        const allowed = await setFlags(mode === "camera", mode === "screen");
        if (!allowed) {
          toast.error("O servidor bloqueou o envio de vídeo para esta conta.");
          return;
        }
        await room.startVideo(mode);
      } finally {
        setBusy(false);
      }
    },
    [activeChannelId, userId, isAdult, room],
  );

  const value = useMemo<VoiceContextValue>(
    () => ({
      active,
      connected: room.connected,
      micOn: room.micOn,
      micStream: room.micStream,
      toggleMic,
      videoMode: room.videoMode,
      localVideoStream: room.localVideoStream,
      remotePeers: room.remotePeers,
      participants: room.participants,
      transmissoes: room.transmissoes,
      assistindo: room.assistindo,
      assistir: room.assistir,
      pararDeAssistir: room.pararDeAssistir,
      speaking,
      participantCount: room.participantCount,
      estadosDeAudio: room.estadosDeAudio,
      peerAudio: prefs.peerAudio,
      setPeerVolume,
      togglePeerMute,
      deafened,
      toggleDeafen,
      busy,
      join,
      leave,
      toggleVideo,
    }),
    [
      active,
      room,
      speaking,
      prefs.peerAudio,
      setPeerVolume,
      togglePeerMute,
      deafened,
      toggleDeafen,
      toggleMic,
      busy,
      join,
      leave,
      toggleVideo,
    ],
  );

  return (
    <VoiceContext.Provider value={value}>
      {children}
      {/* Áudio dos participantes: montado aqui para não parar ao trocar de canal. */}
      {room.remotePeers.map((p) => {
        const a = prefs.peerAudio[p.userId] ?? AUDIO_DO_PARTICIPANTE_PADRAO;
        return (
          <RamoDoParticipante
            key={p.userId}
            peer={p}
            saida={saida}
            ganho={ganhoEfetivo(a.volume, a.muted)}
          />
        );
      })}
    </VoiceContext.Provider>
  );
}

export function useVoice() {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error("useVoice precisa estar dentro de <VoiceProvider>");
  return ctx;
}
