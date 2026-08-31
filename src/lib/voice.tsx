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
import { useVoiceRoom, type RemotePeer } from "@/hooks/useVoiceRoom";
import { useMediaPrefs } from "@/lib/mediaPrefs";
import { useSpeaking } from "@/hooks/useSpeaking";

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
  speaking: Record<string, boolean>;
  participantCount: number;
  /** volume individual de cada participante (0 a 1, 1 = sem atenuar) */
  peerVolumes: Record<string, number>;
  setPeerVolume: (userId: string, volume: number) => void;
  busy: boolean;
  join: (target: VoiceTarget) => void;
  leave: () => void;
  toggleVideo: (mode: "camera" | "screen") => Promise<void>;
};

const VoiceContext = createContext<VoiceContextValue | null>(null);

/** Toca o áudio de um participante. Vive no provider para sobreviver à troca de canal. */
function AudioSink({
  peer,
  speakerId,
  volume,
}: {
  peer: RemotePeer;
  speakerId: string | null;
  volume: number;
}) {
  const ref = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = peer.stream;
  }, [peer.stream]);

  useEffect(() => {
    if (ref.current) ref.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    const el = ref.current as
      (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    // setSinkId não existe em todo navegador (Firefox só com flag). Sem ele, o
    // áudio sai no dispositivo padrão do sistema — degrada, não quebra.
    if (!el?.setSinkId || !speakerId) return;
    void el.setSinkId(speakerId).catch(() => undefined);
  }, [speakerId]);

  return <audio ref={ref} autoPlay playsInline />;
}

/**
 * Sessão de voz global. Fica acima das rotas para que entrar numa mesa não dependa
 * de qual canal está na tela — só o "Sair da mesa" desconecta.
 */
export function VoiceProvider({ children }: { children: ReactNode }) {
  const { session, isAdult } = useAuth();
  const userId = session?.user.id ?? null;

  const [active, setActive] = useState<VoiceTarget | null>(null);
  const [busy, setBusy] = useState(false);

  const { prefs, setPrefs } = useMediaPrefs();
  const room = useVoiceRoom(active?.channelId ?? null, userId, prefs);
  const activeChannelId = active?.channelId ?? null;

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
      void supabase
        .from("voice_participants")
        .delete()
        .eq("channel_id", activeChannelId)
        .eq("user_id", userId)
        .then(({ error }) => {
          if (error) console.error("Falha ao remover presença da mesa de voz", error);
        });
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
      const v = Math.min(1, Math.max(0, volume));
      setPrefs((atual) => ({ peerVolumes: { ...atual.peerVolumes, [peerId]: v } }));
    },
    [setPrefs],
  );

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
      toggleMic: room.toggleMic,
      videoMode: room.videoMode,
      localVideoStream: room.localVideoStream,
      remotePeers: room.remotePeers,
      speaking,
      participantCount: room.participantCount,
      peerVolumes: prefs.peerVolumes,
      setPeerVolume,
      busy,
      join,
      leave,
      toggleVideo,
    }),
    [active, room, speaking, prefs.peerVolumes, setPeerVolume, busy, join, leave, toggleVideo],
  );

  return (
    <VoiceContext.Provider value={value}>
      {children}
      {/* Áudio dos participantes: montado aqui para não parar ao trocar de canal. */}
      {room.remotePeers.map((p) => (
        <AudioSink
          key={p.userId}
          peer={p}
          speakerId={prefs.speakerId}
          volume={prefs.outputVolume * (prefs.peerVolumes[p.userId] ?? 1)}
        />
      ))}
    </VoiceContext.Provider>
  );
}

export function useVoice() {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error("useVoice precisa estar dentro de <VoiceProvider>");
  return ctx;
}
