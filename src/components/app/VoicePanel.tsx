import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, MonitorUp, MonitorX, Video, VideoOff, PhoneOff, Volume2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useVoiceRoom, type RemotePeer } from "@/hooks/useVoiceRoom";
import { useSpeaking } from "@/hooks/useSpeaking";
import { Bottlecap } from "@/components/Bottlecap";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  channelId: string;
  channelName: string;
  userId: string;
  isAdult: boolean;
  names: Record<string, string>;
  onLeave: () => void;
};

function VideoTile({
  stream,
  label,
  muted,
  main,
}: {
  stream: MediaStream;
  label: string;
  muted?: boolean | undefined;
  main?: boolean | undefined;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <div
      className={cn(
        "bg-rail relative overflow-hidden rounded-xl border",
        main ? "border-primary/60 glow-ring" : "border-border",
      )}
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className={cn("w-full bg-black object-contain", main ? "aspect-video" : "aspect-video")}
      />
      <span className="bg-background/85 absolute bottom-2 left-2 rounded-md px-2 py-0.5 text-xs font-medium">
        {label}
      </span>
    </div>
  );
}

function AudioSink({ peer }: { peer: RemotePeer }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = peer.stream;
  }, [peer.stream]);
  return <audio ref={ref} autoPlay playsInline />;
}

export function VoicePanel({ channelId, channelName, userId, isAdult, names, onLeave }: Props) {
  const room = useVoiceRoom(channelId, userId);
  const [busy, setBusy] = useState(false);

  // Presence row in the database — the age rule is enforced there too.
  useEffect(() => {
    void supabase
      .from("voice_participants")
      .upsert({ channel_id: channelId, user_id: userId, camera_on: false, screen_sharing: false }, { onConflict: "channel_id,user_id" });
    return () => {
      void supabase.from("voice_participants").delete().eq("channel_id", channelId).eq("user_id", userId);
    };
  }, [channelId, userId]);

  useEffect(() => {
    if (room.error) toast.error(room.error);
  }, [room.error]);

  // Quem está falando: microfone local + áudio dos colegas.
  const speaking = useSpeaking([
    ...(room.micOn ? [{ id: userId, stream: room.micStream }] : []),
    ...room.remotePeers.map((p) => ({ id: p.userId, stream: p.stream })),
  ]);

  const setMediaFlags = async (camera: boolean, screen: boolean) => {
    const { error } = await supabase
      .from("voice_participants")
      .update({ camera_on: camera, screen_sharing: screen })
      .eq("channel_id", channelId)
      .eq("user_id", userId);
    return !error;
  };

  const handleVideo = async (mode: "camera" | "screen") => {
    if (!isAdult) {
      toast.error("Câmera e compartilhamento de tela são liberados apenas a partir dos 18 anos.");
      return;
    }
    setBusy(true);
    if (room.videoMode === mode) {
      await setMediaFlags(false, false);
      room.stopVideo();
      setBusy(false);
      return;
    }
    const allowed = await setMediaFlags(mode === "camera", mode === "screen");
    if (!allowed) {
      toast.error("O servidor bloqueou o envio de vídeo para esta conta.");
      setBusy(false);
      return;
    }
    await room.startVideo(mode);
    setBusy(false);
  };

  const videoPeers = room.remotePeers.filter((p) => p.hasVideo);
  const tiles: { id: string; stream: MediaStream; label: string; muted?: boolean }[] = [];
  if (room.localVideoStream) {
    tiles.push({
      id: "local",
      stream: room.localVideoStream,
      label: room.videoMode === "screen" ? "Sua tela" : "Sua câmera",
      muted: true,
    });
  }
  videoPeers.forEach((p) =>
    tiles.push({ id: p.userId, stream: p.stream, label: names[p.userId] ?? "Participante" }),
  );

  const [spotlight, ...rest] = tiles;
  const selfName = names[userId] ?? "Você";

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <header className="border-border flex h-14 shrink-0 items-center gap-2 border-b px-5">
        <Volume2 className="text-primary size-4" />
        <h1 className="font-display text-base tracking-wide">{channelName}</h1>
        <span className="text-muted-foreground ml-2 text-xs">
          {room.connected ? `${room.participantCount} na mesa` : "conectando..."}
        </span>
      </header>

      <div className="scrollbar-thin flex-1 overflow-y-auto p-5">
        {!isAdult && (
          <div className="border-warning/40 bg-warning/10 text-warning mb-5 flex items-start gap-2 rounded-xl border p-3 text-sm">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <p>
              Sua conta está em <strong>modo protegido</strong>: você pode falar e ouvir, mas câmera e
              compartilhamento de tela ficam desativados por ser menor de 18 anos.
            </p>
          </div>
        )}

        {spotlight ? (
          <div className="space-y-3">
            {/* tela em destaque — quem tá mostrando o gameplay */}
            <VideoTile stream={spotlight.stream} label={spotlight.label} muted={spotlight.muted} main />
            {rest.length > 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {rest.map((t) => (
                  <VideoTile key={t.id} stream={t.stream} label={t.label} muted={t.muted} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="text-muted-foreground flex h-full min-h-60 flex-col items-center justify-center gap-3 text-center">
            <MonitorUp className="text-primary size-9 opacity-50" />
            <p className="max-w-xs text-sm">
              Mesa de voz aberta. Chega mais, puxa a cadeira!
              {isAdult ? " Quando quiser, mostre sua tela pra turma." : ""}
            </p>
          </div>
        )}

        {/* tampinhas de quem está na mesa, com anel de neon quando fala */}
        <div className="mt-8">
          <p className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-[0.16em] uppercase">
            Na mesa agora
          </p>
          <div className="flex flex-wrap gap-4">
            <div className="flex w-16 flex-col items-center gap-1.5">
              <Bottlecap name={selfName} speaking={!!speaking[userId]} className="size-12" />
              <span className="text-muted-foreground max-w-full truncate text-[11px]">
                {selfName}
              </span>
            </div>
            {room.remotePeers.map((p) => {
              const name = names[p.userId] ?? "Participante";
              return (
                <div key={p.userId} className="flex w-16 flex-col items-center gap-1.5">
                  <Bottlecap name={name} speaking={!!speaking[p.userId]} className="size-12" />
                  <span className="text-muted-foreground max-w-full truncate text-[11px]">{name}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {room.remotePeers.map((p) => (
        <AudioSink key={p.userId} peer={p} />
      ))}

      <div className="border-border bg-surface wood-texture flex shrink-0 flex-wrap items-center justify-center gap-2 border-t p-4">
        <Button variant={room.micOn ? "secondary" : "destructive"} size="sm" onClick={room.toggleMic}>
          {room.micOn ? <Mic className="size-4" /> : <MicOff className="size-4" />}
          {room.micOn ? "Microfone" : "Desmutar"}
        </Button>
        <Button
          variant={room.videoMode === "screen" ? "default" : "secondary"}
          size="sm"
          disabled={busy || !isAdult}
          onClick={() => void handleVideo("screen")}
        >
          {room.videoMode === "screen" ? <MonitorX className="size-4" /> : <MonitorUp className="size-4" />}
          {room.videoMode === "screen" ? "Parar de mostrar" : "Mostrar tela"}
        </Button>
        <Button
          variant={room.videoMode === "camera" ? "default" : "secondary"}
          size="sm"
          disabled={busy || !isAdult}
          onClick={() => void handleVideo("camera")}
        >
          {room.videoMode === "camera" ? <VideoOff className="size-4" /> : <Video className="size-4" />}
          Câmera
        </Button>
        <Button variant="destructive" size="sm" onClick={onLeave}>
          <PhoneOff className="size-4" /> Sair da mesa
        </Button>
      </div>
    </section>
  );
}
