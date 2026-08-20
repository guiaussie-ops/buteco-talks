import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, MonitorUp, MonitorX, Video, VideoOff, PhoneOff, Volume2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useVoiceRoom, type RemotePeer } from "@/hooks/useVoiceRoom";
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
  highlight,
}: {
  stream: MediaStream;
  label: string;
  muted?: boolean;
  highlight?: boolean;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <div
      className={cn(
        "bg-rail border-border relative overflow-hidden rounded-xl border",
        highlight && "border-primary/60 glow-ring",
      )}
    >
      <video ref={ref} autoPlay playsInline muted={muted} className="aspect-video w-full bg-black object-contain" />
      <span className="bg-background/80 absolute bottom-2 left-2 rounded-md px-2 py-0.5 text-xs font-medium">
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

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <header className="border-border flex h-14 shrink-0 items-center gap-2 border-b px-5">
        <Volume2 className="text-primary size-4" />
        <h1 className="font-display text-sm font-semibold">{channelName}</h1>
        <span className="text-muted-foreground ml-2 text-xs">
          {room.connected ? `${room.participantCount} na sala` : "conectando..."}
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

        {room.localVideoStream || videoPeers.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {room.localVideoStream && (
              <VideoTile
                stream={room.localVideoStream}
                label={room.videoMode === "screen" ? "Sua tela" : "Sua câmera"}
                muted
                highlight
              />
            )}
            {videoPeers.map((p) => (
              <VideoTile key={p.userId} stream={p.stream} label={names[p.userId] ?? "Participante"} />
            ))}
          </div>
        ) : (
          <div className="text-muted-foreground flex h-full min-h-60 flex-col items-center justify-center gap-2 text-center">
            <MonitorUp className="size-8 opacity-40" />
            <p className="text-sm">
              Ninguém está transmitindo ainda.
              {isAdult ? " Clique em Compartilhar tela para começar." : ""}
            </p>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          {room.remotePeers.map((p) => (
            <span key={p.userId} className="bg-surface rounded-full px-3 py-1 text-xs">
              {names[p.userId] ?? "Participante"}
            </span>
          ))}
        </div>
      </div>

      {room.remotePeers.map((p) => (
        <AudioSink key={p.userId} peer={p} />
      ))}

      <div className="border-border bg-surface flex shrink-0 flex-wrap items-center justify-center gap-2 border-t p-4">
        <Button variant={room.micOn ? "secondary" : "destructive"} size="sm" onClick={room.toggleMic}>
          {room.micOn ? <Mic className="size-4" /> : <MicOff className="size-4" />}
          {room.micOn ? "Microfone" : "Mudo"}
        </Button>
        <Button
          variant={room.videoMode === "screen" ? "default" : "secondary"}
          size="sm"
          disabled={busy || !isAdult}
          onClick={() => void handleVideo("screen")}
        >
          {room.videoMode === "screen" ? <MonitorX className="size-4" /> : <MonitorUp className="size-4" />}
          {room.videoMode === "screen" ? "Parar tela" : "Compartilhar tela"}
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
          <PhoneOff className="size-4" /> Sair da sala
        </Button>
      </div>
    </section>
  );
}
