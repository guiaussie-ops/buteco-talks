import { useEffect, useState } from "react";
import {
  Headphones,
  HeadphoneOff,
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  Video,
  VideoOff,
  PhoneOff,
  ShieldAlert,
  Armchair,
} from "lucide-react";
import { useVoice } from "@/lib/voice";
import { Bottlecap } from "@/components/Bottlecap";
import { Button } from "@/components/ui/button";
import { MiniMesa } from "@/components/app/Mesas";
import {
  ControleDeVolume,
  SeloDeMicFechado,
  SeloDeMudo,
  useAudioDoParticipante,
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
  /** Sentar nesta mesa, quando você está olhando para ela de fora. */
  onPuxarCadeira: () => void;
};

/** Tamanho máximo da área da mesa, em px. No celular ela encolhe para caber. */
const AREA_MAXIMA = 440;

/**
 * Onde cada tampinha senta: distribuídas em volta da mesa, a primeira em cima.
 * Com muita gente, as cadeiras só ficam mais juntas — a mesa não cresce.
 */
function lugar(i: number, total: number, area: number) {
  const angulo = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(total, 1);
  const raio = area * 0.405;
  return {
    left: area / 2 + raio * Math.cos(angulo),
    top: area / 2 + raio * Math.sin(angulo),
  };
}

/** A área da mesa cabe na largura da tela, até o máximo. */
function useAreaDaMesa() {
  const [area, setArea] = useState(AREA_MAXIMA);
  useEffect(() => {
    const medir = () => setArea(Math.min(AREA_MAXIMA, window.innerWidth - 32));
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, []);
  return area;
}

/**
 * Tampinha de quem está sentado, com o volume individual dela no clique. O
 * mesmo controle vive na barra lateral — ver ControleDeVolume.
 */
function Cadeira({
  userId,
  name,
  src,
  speaking,
  micOff,
  transmitindo,
  ehVoce,
}: {
  userId: string;
  name: string;
  src?: string | null | undefined;
  speaking: boolean;
  /** O microfone DELA está fechado — foi ela que publicou isso na presença. */
  micOff: boolean;
  transmitindo: boolean;
  ehVoce: boolean;
}) {
  const { muted } = useAudioDoParticipante(userId);

  // Os dois selos dizem coisas diferentes e não podem virar um só: o de mudo é
  // uma escolha minha sobre o meu fone, o de microfone fechado é um fato sobre
  // ela. Se eu mutei alguém que já está de microfone fechado, o meu vence.
  const selo = ehVoce ? null : muted ? (
    <SeloDeMudo className="size-3.5" />
  ) : micOff ? (
    <SeloDeMicFechado className="size-3.5" />
  ) : null;

  const tampinha = (
    <span className="relative block">
      <Bottlecap
        name={name}
        src={src}
        speaking={speaking}
        className={cn(
          "size-16 text-xl",
          ehVoce && "ring-foreground/60 ring-2 ring-offset-2 ring-offset-transparent",
        )}
      />
      {selo && (
        <span className="bg-background/90 absolute -right-0.5 -bottom-0.5 rounded-full p-1">
          {selo}
        </span>
      )}
      {transmitindo && (
        <span
          title="Mostrando a tela"
          className="bg-neon text-neon-foreground absolute -top-1 -right-1 rounded-full p-1"
        >
          <MonitorUp className="size-3" />
        </span>
      )}
    </span>
  );

  return (
    <div className="flex w-24 flex-col items-center gap-1.5">
      {ehVoce ? (
        tampinha
      ) : (
        <ControleDeVolume userId={userId} name={name} className="rounded-full">
          {tampinha}
        </ControleDeVolume>
      )}
      <span className="bg-background/80 max-w-full truncate rounded-md px-1.5 text-xs">
        {ehVoce ? `${name} (você)` : name}
      </span>
    </div>
  );
}

/**
 * Mesa de voz por dentro: a mesa grande no centro, com as tampinhas de quem
 * está sentado em volta. As transmissões NÃO moram aqui: ficam na coluna "Na
 * tela agora", à direita, em qualquer tela do buteco.
 *
 * É só a *view* — a conexão vive no VoiceProvider, então trocar de mesa na
 * tela não derruba a voz.
 */
export function VoicePanel({
  channelId,
  channelName,
  userId,
  isAdult,
  names,
  avatars,
  onLeave,
  onPuxarCadeira,
}: Props) {
  const voice = useVoice();
  const area = useAreaDaMesa();
  const sentado = voice.active?.channelId === channelId;

  /**
   * Quem está na mesa vem da presença, não de quem mandou mídia: é o que faz o
   * ouvinte sem microfone aparecer e ser contado. O `[userId]` é a rede de
   * segurança do instante entre entrar e a presença sincronizar.
   */
  const naMesa = sentado ? (voice.participants.length > 0 ? voice.participants : [userId]) : [];

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <header className="border-border flex h-14 shrink-0 items-center gap-3 border-b px-5">
        <MiniMesa tipo="voice" sentados={naMesa.map((id) => names[id] ?? "?")} />
        <h1 className="font-display truncate text-xl tracking-wide">{channelName}</h1>
        <span className="text-muted-foreground text-xs">
          {!sentado
            ? "você não está sentado aqui"
            : voice.connected
              ? `${voice.participantCount} na mesa`
              : "puxando a cadeira..."}
        </span>
      </header>

      <div className="piso-de-madeira scrollbar-thin relative flex flex-1 flex-col items-center justify-center overflow-auto p-6">
        {!isAdult && (
          <div className="border-warning/40 bg-background/90 text-warning mb-5 flex max-w-xl items-start gap-2 rounded-xl border p-3 text-sm">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <p>
              Sua conta está em <strong>modo protegido</strong>: você pode falar e ouvir, mas câmera
              e compartilhamento de tela ficam desativados por ser menor de 18 anos.
            </p>
          </div>
        )}

        <div className="relative shrink-0" style={{ width: area, height: area }}>
          {/* o tampo */}
          <div
            className="bg-mesa border-mesa-borda absolute flex flex-col items-center justify-center gap-2 rounded-full border-[12px] text-center shadow-[0_24px_50px_rgb(0_0_0/0.55)]"
            style={{ inset: area * 0.22 }}
          >
            <span className="font-display px-4 text-3xl leading-none tracking-wide">
              {channelName}
            </span>
            {sentado ? (
              <span className="text-foreground/70 text-xs">
                {naMesa.length === 1 ? "só você por enquanto" : `${naMesa.length} sentados`}
              </span>
            ) : (
              <Button size="sm" onClick={onPuxarCadeira}>
                <Armchair className="size-4" /> Puxar cadeira
              </Button>
            )}
          </div>

          {/* as cadeiras */}
          {naMesa.map((id, i) => {
            const { left, top } = lugar(i, naMesa.length, area);
            return (
              <div
                key={id}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left, top }}
              >
                <Cadeira
                  userId={id}
                  name={names[id] ?? (id === userId ? "Você" : "Participante")}
                  src={avatars[id]}
                  speaking={!!voice.speaking[id]}
                  micOff={!!voice.estadosDeAudio[id]?.micOff}
                  transmitindo={
                    id === userId ? voice.videoMode !== "none" : id in voice.transmissoes
                  }
                  ehVoce={id === userId}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-border bg-surface wood-texture flex shrink-0 flex-wrap items-center justify-center gap-2 border-t p-4">
        <Button
          variant={voice.micOn ? "secondary" : "destructive"}
          size="sm"
          disabled={!sentado}
          onClick={voice.toggleMic}
        >
          {voice.micOn ? <Mic className="size-4" /> : <MicOff className="size-4" />}
          {voice.micOn ? "Microfone" : "Desmutar"}
        </Button>
        <Button
          variant={voice.deafened ? "destructive" : "secondary"}
          size="sm"
          disabled={!sentado}
          onClick={voice.toggleDeafen}
          title={
            voice.deafened
              ? "Voltar a ouvir a mesa (e reabrir o microfone, se estava aberto)"
              : "Parar de ouvir a mesa — fecha o seu microfone junto"
          }
        >
          {voice.deafened ? <HeadphoneOff className="size-4" /> : <Headphones className="size-4" />}
          {voice.deafened ? "Voltar a ouvir" : "Fone"}
        </Button>
        <Button
          variant={voice.videoMode === "screen" ? "default" : "secondary"}
          size="sm"
          disabled={voice.busy || !isAdult || !sentado}
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
          disabled={voice.busy || !isAdult || !sentado}
          onClick={() => void voice.toggleVideo("camera")}
        >
          {voice.videoMode === "camera" ? (
            <VideoOff className="size-4" />
          ) : (
            <Video className="size-4" />
          )}
          Câmera
        </Button>
        <Button variant="destructive" size="sm" disabled={!sentado} onClick={onLeave}>
          <PhoneOff className="size-4" /> Levantar da mesa
        </Button>
      </div>
    </section>
  );
}
