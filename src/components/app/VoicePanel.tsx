import { useEffect, useRef } from "react";
import {
  Eye,
  EyeOff,
  Loader2,
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  Video,
  VideoOff,
  PhoneOff,
  Volume2,
  ShieldAlert,
} from "lucide-react";
import { useVoice } from "@/lib/voice";
import { Bottlecap } from "@/components/Bottlecap";
import { Button } from "@/components/ui/button";
import {
  ControleDeVolume,
  SeloDeMudo,
  useVolumeDoParticipante,
} from "@/components/app/ControleDeVolume";
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
  onParar,
}: {
  stream: MediaStream;
  label: string;
  muted?: boolean | undefined;
  main?: boolean | undefined;
  /** Só nas transmissões dos outros: fechar devolve a banda na hora. */
  onParar?: (() => void) | undefined;
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
      {onParar && (
        <Button
          size="sm"
          variant="secondary"
          className="bg-background/85 hover:bg-background absolute top-2 right-2 h-7 px-2 text-xs"
          onClick={onParar}
        >
          <EyeOff className="size-3.5" /> Parar de assistir
        </Button>
      )}
    </div>
  );
}

/**
 * Convite de transmissão: alguém está mostrando alguma coisa, e você decide se
 * quer ver. Enquanto você não clica, nenhum pacote de vídeo daquela pessoa
 * chega até aqui — o sender do outro lado está com a faixa em `null`.
 */
function ConviteDeTransmissao({
  nome,
  src,
  modo,
  pedido,
  onAssistir,
}: {
  nome: string;
  src?: string | null | undefined;
  modo: "camera" | "screen";
  /** Já pedi e estou esperando a faixa chegar. */
  pedido: boolean;
  onAssistir: () => void;
}) {
  return (
    <div className="border-primary/40 bg-surface-2 flex items-center gap-3 rounded-xl border p-3">
      <Bottlecap name={nome} src={src} className="size-10" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          <strong className="font-display tracking-wide">{nome}</strong>{" "}
          {modo === "screen" ? "está mostrando a tela" : "está com a câmera ligada"}
        </p>
        <p className="text-muted-foreground text-xs">
          {pedido
            ? "Abrindo a transmissão…"
            : "Só carrega se você pedir — sem clicar, não gasta a sua banda."}
        </p>
      </div>
      {pedido ? (
        <Button size="sm" variant="secondary" disabled>
          <Loader2 className="size-4 animate-spin" /> Abrindo
        </Button>
      ) : (
        <Button size="sm" onClick={onAssistir}>
          <Eye className="size-4" /> Assistir
        </Button>
      )}
    </div>
  );
}

/**
 * Tampinha de um participante remoto com o volume individual dela.
 * O mesmo controle vive na barra lateral — ver ControleDeVolume.
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
  const { percent } = useVolumeDoParticipante(userId);

  return (
    <div className="flex w-16 flex-col items-center gap-1.5">
      <ControleDeVolume userId={userId} name={name} className="rounded-full">
        <span className="relative block">
          <Bottlecap name={name} src={src} speaking={speaking} className="size-12" />
          {percent === 0 && (
            <span className="bg-background/85 absolute -right-0.5 -bottom-0.5 rounded-full p-0.5">
              <SeloDeMudo className="size-3" />
            </span>
          )}
        </span>
      </ControleDeVolume>
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

  // Só chega aqui a transmissão de quem você pediu para assistir: quem não foi
  // pedido está com a faixa em `null` do outro lado e nem tem o que renderizar.
  const videoPeers = voice.remotePeers.filter((p) => p.hasVideo);
  const tiles: {
    id: string;
    stream: MediaStream;
    label: string;
    muted?: boolean;
    onParar?: () => void;
  }[] = [];
  if (voice.localVideoStream) {
    tiles.push({
      id: "local",
      stream: voice.localVideoStream,
      label: voice.videoMode === "screen" ? "Sua tela" : "Sua câmera",
      muted: true,
    });
  }
  videoPeers.forEach((p) =>
    tiles.push({
      id: p.userId,
      stream: p.stream,
      label: names[p.userId] ?? "Participante",
      onParar: () => voice.pararDeAssistir(p.userId),
    }),
  );

  /**
   * Transmissões que existem mas que você ainda não está vendo: as que você não
   * pediu, e as que você acabou de pedir e ainda não chegaram. Cada uma é
   * independente, então várias pessoas podem transmitir ao mesmo tempo.
   */
  const chegou = new Set(videoPeers.map((p) => p.userId));
  const convites = viewingActiveRoom
    ? Object.entries(voice.transmissoes)
        .filter(([id]) => !chegou.has(id))
        .map(([id, modo]) => ({ id, modo, pedido: voice.assistindo.includes(id) }))
    : [];

  const [spotlight, ...rest] = tiles;
  const selfName = names[userId] ?? "Você";

  /**
   * Quem está na mesa vem da presença, não de quem mandou mídia: é o que faz o
   * ouvinte sem microfone aparecer e ser contado. O `[userId]` é a rede de
   * segurança do instante entre entrar e a presença sincronizar.
   */
  const naMesa = voice.participants.length > 0 ? voice.participants : [userId];

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

        {convites.length > 0 && (
          <div className="mb-5 space-y-2">
            {convites.map((c) => (
              <ConviteDeTransmissao
                key={c.id}
                nome={names[c.id] ?? "Participante"}
                src={avatars[c.id]}
                modo={c.modo}
                pedido={c.pedido}
                onAssistir={() => voice.assistir(c.id)}
              />
            ))}
          </div>
        )}

        {viewingActiveRoom && spotlight ? (
          <div className="space-y-3">
            {/* tela em destaque — quem tá mostrando o gameplay */}
            <VideoTile
              stream={spotlight.stream}
              label={spotlight.label}
              muted={spotlight.muted}
              onParar={spotlight.onParar}
              main
            />
            {rest.length > 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {rest.map((t) => (
                  <VideoTile
                    key={t.id}
                    stream={t.stream}
                    label={t.label}
                    muted={t.muted}
                    onParar={t.onParar}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          convites.length === 0 && (
            <div className="text-muted-foreground flex h-full min-h-60 flex-col items-center justify-center gap-3 text-center">
              <MonitorUp className="text-primary size-9 opacity-50" />
              <p className="max-w-xs text-sm">
                Mesa de voz aberta. Chega mais, puxa a cadeira!
                {isAdult ? " Quando quiser, mostre sua tela pra turma." : ""}
              </p>
            </div>
          )
        )}

        {/* tampinhas de quem está na mesa, com anel de neon quando fala */}
        {viewingActiveRoom && (
          <div className="mt-8">
            <p className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-[0.16em] uppercase">
              Na mesa agora
            </p>
            <div className="flex flex-wrap gap-4">
              {naMesa.map((id) =>
                id === userId ? (
                  // Você não tem controle de volume da própria voz.
                  <div key={id} className="flex w-16 flex-col items-center gap-1.5">
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
                ) : (
                  <PeerCap
                    key={id}
                    userId={id}
                    name={names[id] ?? "Participante"}
                    src={avatars[id]}
                    speaking={!!voice.speaking[id]}
                  />
                ),
              )}
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
