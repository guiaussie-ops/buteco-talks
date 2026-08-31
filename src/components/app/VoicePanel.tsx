import { useEffect, useRef } from "react";
import {
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  Video,
  VideoOff,
  PhoneOff,
  Volume2,
  VolumeX,
  ShieldAlert,
} from "lucide-react";
import { useVoice } from "@/lib/voice";
import { Bottlecap } from "@/components/Bottlecap";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

type Props = {
  channelId: string;
  channelName: string;
  userId: string;
  isAdult: boolean;
  names: Record<string, string>;
  avatars: Record<string, string | null>;
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

/**
 * Tampinha de um participante remoto com o volume individual dela.
 * Abre no clique (e não no hover) porque no celular não existe hover.
 */
function PeerCap({
  userId,
  name,
  src,
  speaking,
}: {
  userId: string;
  name: string;
  src?: string | null | undefined;
  speaking: boolean;
}) {
  const voice = useVoice();
  const volume = voice.peerVolumes[userId] ?? 1;
  const percent = Math.round(volume * 100);

  return (
    <div className="flex w-16 flex-col items-center gap-1.5">
      <Popover>
        <PopoverTrigger
          className="focus-visible:ring-ring rounded-full focus-visible:ring-2 focus-visible:outline-none"
          aria-label={`Volume de ${name}: ${percent}%`}
        >
          <span className="relative block">
            <Bottlecap name={name} src={src} speaking={speaking} className="size-12" />
            {percent === 0 && (
              <span className="bg-background/85 text-muted-foreground absolute -right-0.5 -bottom-0.5 rounded-full p-0.5">
                <VolumeX className="size-3" />
              </span>
            )}
          </span>
        </PopoverTrigger>
        <PopoverContent align="center" className="w-56 space-y-2 p-3">
          <p className="truncate text-sm font-medium">{name}</p>
          <Slider
            min={0}
            max={100}
            step={5}
            value={[percent]}
            onValueChange={([v]) => voice.setPeerVolume(userId, (v ?? 100) / 100)}
            aria-label={`Volume de ${name}`}
          />
          <p className="text-muted-foreground text-xs">
            {percent === 0 ? "Mudo pra você" : `${percent}% — só pra você.`}
          </p>
        </PopoverContent>
      </Popover>
      <span className="text-muted-foreground max-w-full truncate text-[11px]">{name}</span>
    </div>
  );
}

/**
 * Tela da mesa de voz. É só a *view* — a conexão vive no VoiceProvider,
 * então desmontar este componente (trocar de canal) não derruba a voz.
 */
export function VoicePanel({
  channelId,
  channelName,
  userId,
  isAdult,
  names,
  avatars,
  onLeave,
}: Props) {
  const voice = useVoice();
  const viewingActiveRoom = voice.active?.channelId === channelId;

  const videoPeers = voice.remotePeers.filter((p) => p.hasVideo);
  const tiles: { id: string; stream: MediaStream; label: string; muted?: boolean }[] = [];
  if (voice.localVideoStream) {
    tiles.push({
      id: "local",
      stream: voice.localVideoStream,
      label: voice.videoMode === "screen" ? "Sua tela" : "Sua câmera",
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
          {!viewingActiveRoom
            ? "você não está nesta mesa"
            : voice.connected
              ? `${voice.participantCount} na mesa`
              : "conectando..."}
        </span>
      </header>

      <div className="scrollbar-thin flex-1 overflow-y-auto p-5">
        {!isAdult && (
          <div className="border-warning/40 bg-warning/10 text-warning mb-5 flex items-start gap-2 rounded-xl border p-3 text-sm">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <p>
              Sua conta está em <strong>modo protegido</strong>: você pode falar e ouvir, mas câmera
              e compartilhamento de tela ficam desativados por ser menor de 18 anos.
            </p>
          </div>
        )}

        {viewingActiveRoom && spotlight ? (
          <div className="space-y-3">
            {/* tela em destaque — quem tá mostrando o gameplay */}
            <VideoTile
              stream={spotlight.stream}
              label={spotlight.label}
              muted={spotlight.muted}
              main
            />
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
        {viewingActiveRoom && (
          <div className="mt-8">
            <p className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-[0.16em] uppercase">
              Na mesa agora
            </p>
            <div className="flex flex-wrap gap-4">
              <div className="flex w-16 flex-col items-center gap-1.5">
                <Bottlecap
                  name={selfName}
                  src={avatars[userId]}
                  speaking={!!voice.speaking[userId]}
                  className="size-12"
                />
                <span className="text-muted-foreground max-w-full truncate text-[11px]">
                  {selfName}
                </span>
              </div>
              {voice.remotePeers.map((p) => (
                <PeerCap
                  key={p.userId}
                  userId={p.userId}
                  name={names[p.userId] ?? "Participante"}
                  src={avatars[p.userId]}
                  speaking={!!voice.speaking[p.userId]}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="border-border bg-surface wood-texture flex shrink-0 flex-wrap items-center justify-center gap-2 border-t p-4">
        <Button
          variant={voice.micOn ? "secondary" : "destructive"}
          size="sm"
          disabled={!viewingActiveRoom}
          onClick={voice.toggleMic}
        >
          {voice.micOn ? <Mic className="size-4" /> : <MicOff className="size-4" />}
          {voice.micOn ? "Microfone" : "Desmutar"}
        </Button>
        <Button
          variant={voice.videoMode === "screen" ? "default" : "secondary"}
          size="sm"
          disabled={voice.busy || !isAdult || !viewingActiveRoom}
          onClick={() => void voice.toggleVideo("screen")}
        >
          {voice.videoMode === "screen" ? (
            <MonitorX className="size-4" />
          ) : (
            <MonitorUp className="size-4" />
          )}
          {voice.videoMode === "screen" ? "Parar de mostrar" : "Mostrar tela"}
        </Button>
        <Button
          variant={voice.videoMode === "camera" ? "default" : "secondary"}
          size="sm"
          disabled={voice.busy || !isAdult || !viewingActiveRoom}
          onClick={() => void voice.toggleVideo("camera")}
        >
          {voice.videoMode === "camera" ? (
            <VideoOff className="size-4" />
          ) : (
            <Video className="size-4" />
          )}
          Câmera
        </Button>
        <Button variant="destructive" size="sm" disabled={!viewingActiveRoom} onClick={onLeave}>
          <PhoneOff className="size-4" /> Sair da mesa
        </Button>
      </div>
    </section>
  );
}
