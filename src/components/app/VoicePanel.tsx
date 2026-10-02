import { useEffect, useRef, type ReactNode } from "react";
import {
  Eye,
  EyeOff,
  Headphones,
  HeadphoneOff,
  Loader2,
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
import { chaveDaTela, useVoice } from "@/lib/voice";
import { Bottlecap } from "@/components/Bottlecap";
import { Button } from "@/components/ui/button";
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
};

/**
 * Um quadro de transmissão. SEMPRE mudo, e isto não é detalhe de estilo.
 *
 * O stream que chega de um participante carrega a voz e o vídeo dele juntos. Um
 * <video> sem `muted` toca esse áudio por conta própria, no volume dele — em
 * paralelo com o grafo de saída, que é quem o slider controla. Era exatamente
 * esse o bug do "slider anda e o volume não muda": quem estava transmitindo
 * continuava sendo ouvido em 100% por este elemento aqui, por baixo.
 *
 * A voz de todo mundo sai por um caminho só: `saidaDeAudio`. Aqui é imagem.
 */
function VideoTile({
  stream,
  label,
  main,
  onParar,
  onFocar,
  som,
}: {
  stream: MediaStream;
  label: string;
  main?: boolean | undefined;
  /** Só nas transmissões dos outros: fechar devolve a banda na hora. */
  onParar?: (() => void) | undefined;
  /** Na coluna: clicar traz esta transmissão para a tela grande, com o som dela. */
  onFocar?: (() => void) | undefined;
  /**
   * O que mostrar sobre o som desta transmissão. Na tela grande, o controle de
   * volume; na coluna, o selo de "sem som". Ausente na minha própria tela.
   */
  som?: ReactNode;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    // Largar o srcObject é o que solta a referência ao stream — o mesmo motivo
    // documentado em `soltar`, no saidaDeAudio. Sem isto, o elemento que sai da
    // tela ao fechar uma transmissão continua segurando o stream (e o decoder
    // de vídeo junto) até o coletor passar, se passar.
    return () => {
      el.srcObject = null;
    };
  }, [stream]);
  return (
    <div
      className={cn(
        "bg-rail group/tile relative overflow-hidden rounded-xl border",
        main ? "border-primary/60 glow-ring" : "border-border",
        onFocar && "hover:border-primary/60 cursor-pointer transition-colors",
      )}
      onClick={onFocar}
      role={onFocar ? "button" : undefined}
      tabIndex={onFocar ? 0 : undefined}
      onKeyDown={
        onFocar
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onFocar();
              }
            }
          : undefined
      }
      title={onFocar ? `Assistir ${label} na tela grande, com o som` : undefined}
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        className="aspect-video w-full bg-black object-contain"
      />
      <span className="bg-background/85 absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium">
        <span className="truncate">{label}</span>
      </span>
      {som && <div className="absolute right-2 bottom-2">{som}</div>}
      {onFocar && (
        <span className="bg-background/70 pointer-events-none absolute inset-0 hidden items-center justify-center text-xs font-semibold group-hover/tile:flex">
          <Volume2 className="mr-1.5 size-4" /> Ouvir esta
        </span>
      )}
      {onParar && (
        /*
         * Sólido no neon da identidade, e não um ghost translúcido. Este botão
         * fica POR CIMA de vídeo arbitrário: um fundo semitransparente herda o
         * contraste do quadro que estiver passando atrás, e num gameplay claro
         * ele simplesmente some. Cor chapada resolve o contraste sozinha, e o
         * anel escuro separa a borda de um quadro que seja quase da mesma cor.
         */
        <Button
          size="sm"
          title="Parar de assistir"
          className={cn(
            "bg-neon text-neon-foreground hover:bg-neon/90 absolute top-2 right-2 z-10 h-7 text-xs font-semibold shadow-md ring-1 ring-black/25",
            main ? "px-2" : "w-7 px-0",
          )}
          onClick={(e) => {
            // Na coluna o quadro inteiro é clicável; parar não pode virar focar.
            e.stopPropagation();
            onParar();
          }}
        >
          <EyeOff className="size-3.5" />
          {main && "Parar de assistir"}
        </Button>
      )}
    </div>
  );
}

/** Quadro da tela grande enquanto a transmissão escolhida ainda está chegando. */
function TelaChegando({ label }: { label: string }) {
  return (
    <div className="border-primary/60 bg-rail flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl border">
      <Loader2 className="text-primary size-6 animate-spin" />
      <p className="text-muted-foreground text-sm">Abrindo a transmissão de {label}…</p>
    </div>
  );
}

/**
 * Som da transmissão em foco: o volume dela, separado do volume da voz da
 * pessoa. Dá para deixar o jogo baixinho e a voz alta, como no Discord.
 */
function SomDaTransmissao({
  userId,
  nome,
  temAudio,
}: {
  userId: string;
  nome: string;
  temAudio: boolean;
}) {
  const { muted } = useAudioDoParticipante(chaveDaTela(userId));
  if (!temAudio) {
    return (
      <span
        className="bg-background/85 text-muted-foreground flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px]"
        title="Quem transmite não marcou “compartilhar áudio”, ou é câmera"
      >
        <VolumeX className="size-3" /> sem áudio
      </span>
    );
  }
  return (
    <ControleDeVolume
      userId={chaveDaTela(userId)}
      name={`Transmissão de ${nome}`}
      align="end"
      className="bg-background/85 hover:bg-background flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium"
    >
      {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="text-primary size-3.5" />}
      {muted ? "mudo" : "som da tela"}
    </ControleDeVolume>
  );
}

/** Selo das transmissões fora de foco: passam, mas sem som. */
function SeloSemSom() {
  return (
    <span className="bg-background/85 text-muted-foreground flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px]">
      <VolumeX className="size-3" /> sem som
    </span>
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
  micOff,
}: {
  userId: string;
  name: string;
  src?: string | null | undefined;
  speaking: boolean;
  /** O microfone DELA está fechado — foi ela que publicou isso na presença. */
  micOff: boolean;
}) {
  const { muted } = useAudioDoParticipante(userId);

  // Os dois selos dizem coisas diferentes e não podem virar um só: o de mudo é
  // uma escolha minha sobre o meu fone, o de microfone fechado é um fato sobre
  // ela. Se eu mutei alguém que já está de microfone fechado, o meu vence na
  // tampinha: é o que explica o silêncio se ela voltar a falar.
  const selo = muted ? (
    <SeloDeMudo className="size-3" />
  ) : micOff ? (
    <SeloDeMicFechado className="size-3" />
  ) : null;

  return (
    <div className="flex w-16 flex-col items-center gap-1.5">
      <ControleDeVolume userId={userId} name={name} className="rounded-full">
        <span className="relative block">
          <Bottlecap name={name} src={src} speaking={speaking} className="size-12" />
          {selo && (
            <span className="bg-background/85 absolute -right-0.5 -bottom-0.5 rounded-full p-0.5">
              {selo}
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
  const nomeDe = (id: string) => names[id] ?? "Participante";

  /**
   * A tela grande é a transmissão em FOCO — a única que toca som. As outras
   * que você assiste vão para a coluna, passando sem som, e um clique troca o
   * foco. Sem foco (você não assiste ninguém), a sua própria tela ocupa o
   * lugar, como antes.
   */
  const foco = viewingActiveRoom ? voice.foco : null;
  const peerEmFoco = foco ? videoPeers.find((p) => p.userId === foco) : undefined;
  const principal: ReactNode = foco ? (
    peerEmFoco ? (
      <VideoTile
        stream={peerEmFoco.stream}
        label={nomeDe(foco)}
        onParar={() => voice.pararDeAssistir(foco)}
        som={
          <SomDaTransmissao userId={foco} nome={nomeDe(foco)} temAudio={!!peerEmFoco.audioDaTela} />
        }
        main
      />
    ) : (
      <TelaChegando label={nomeDe(foco)} />
    )
  ) : voice.localVideoStream ? (
    <VideoTile
      stream={voice.localVideoStream}
      label={voice.videoMode === "screen" ? "Sua tela" : "Sua câmera"}
      main
    />
  ) : null;

  const coluna = [
    ...videoPeers
      .filter((p) => p.userId !== foco)
      .map((p) => (
        <VideoTile
          key={p.userId}
          stream={p.stream}
          label={nomeDe(p.userId)}
          onParar={() => voice.pararDeAssistir(p.userId)}
          onFocar={() => voice.focar(p.userId)}
          som={p.audioDaTela ? <SeloSemSom /> : undefined}
        />
      )),
    // Pedidas mas ainda chegando: guardam o lugar na coluna em vez de sumir.
    ...voice.assistindo
      .filter(
        (id) =>
          viewingActiveRoom &&
          id !== foco &&
          id in voice.transmissoes &&
          !videoPeers.some((p) => p.userId === id),
      )
      .map((id) => (
        <div
          key={`chegando-${id}`}
          className="border-border bg-rail text-muted-foreground flex aspect-video items-center justify-center gap-2 rounded-xl border text-xs"
        >
          <Loader2 className="size-4 animate-spin" /> {nomeDe(id)}
        </div>
      )),
    // A própria tela vai para a coluna quando outra transmissão está em foco:
    // é só um retorno do que você está mostrando, nunca tem som.
    ...(foco && voice.localVideoStream
      ? [
          <VideoTile
            key="local"
            stream={voice.localVideoStream}
            label={voice.videoMode === "screen" ? "Sua tela" : "Sua câmera"}
          />,
        ]
      : []),
  ];

  /**
   * Transmissões que existem mas que você ainda não está vendo: as que você não
   * pediu. Cada uma é independente, então várias pessoas podem transmitir ao
   * mesmo tempo. Assistir uma nova já a traz para o foco.
   */
  const convites = viewingActiveRoom
    ? Object.entries(voice.transmissoes)
        .filter(([id]) => !voice.assistindo.includes(id))
        .map(([id, modo]) => ({ id, modo }))
    : [];

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
                pedido={false}
                onAssistir={() => {
                  voice.assistir(c.id);
                  voice.focar(c.id);
                }}
              />
            ))}
          </div>
        )}

        {viewingActiveRoom && principal ? (
          // Tela grande à esquerda e a coluna das outras à direita; no celular
          // a coluna desce e vira uma fileira que rola para o lado.
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1">{principal}</div>
            {coluna.length > 0 && (
              <div className="scrollbar-thin flex shrink-0 gap-3 overflow-x-auto pb-1 lg:max-h-[75vh] lg:w-56 lg:flex-col lg:overflow-x-visible lg:overflow-y-auto lg:pb-0 xl:w-64 [&>*]:w-48 [&>*]:shrink-0 lg:[&>*]:w-full">
                {coluna}
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
                    micOff={!!voice.estadosDeAudio[id]?.micOff}
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
          variant={voice.deafened ? "destructive" : "secondary"}
          size="sm"
          disabled={!viewingActiveRoom}
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
