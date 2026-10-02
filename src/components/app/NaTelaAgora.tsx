import {
  Eye,
  EyeOff,
  Loader2,
  Maximize2,
  MonitorUp,
  MonitorX,
  Video,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useVoice } from "@/lib/voice";
import { cn } from "@/lib/utils";
import { Bottlecap } from "@/components/Bottlecap";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SomDaTransmissao, VideoDoStream } from "@/components/app/TelaCheia";

/** Se a coluna tem o que mostrar: alguém transmitindo na minha mesa, ou eu mesmo. */
export function useTemTelaAgora() {
  const voice = useVoice();
  return !!voice.active && (Object.keys(voice.transmissoes).length > 0 || !!voice.localVideoStream);
}

/** Selo do canto da miniatura: com som (a escolhida) ou sem. */
function SeloDeSom({ comSom }: { comSom: boolean }) {
  return (
    <span
      className={cn(
        "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
        comSom ? "bg-primary text-primary-foreground" : "bg-background/85 text-muted-foreground",
      )}
    >
      {comSom ? <Volume2 className="size-3" /> : <VolumeX className="size-3" />}
      {comSom ? "com som" : "sem som"}
    </span>
  );
}

/**
 * Uma transmissão em miniatura. Clicar abre as opções: tela cheia, ouvir aqui
 * na miniatura, só a imagem, ou parar.
 *
 * Enquanto você não pede, nenhum pacote de vídeo dela chega até aqui (o sender
 * do outro lado fica em `null`): o quadro mostra só a tampinha da pessoa. Isso
 * é o que mantém a subida de quem transmite de pé numa mesa cheia.
 */
function Miniatura({
  userId,
  nome,
  avatar,
  modo,
}: {
  userId: string;
  nome: string;
  avatar: string | null | undefined;
  modo: "camera" | "screen";
}) {
  const voice = useVoice();
  const peer = voice.remotePeers.find((p) => p.userId === userId);
  const assistindo = voice.assistindo.includes(userId);
  const comSom = voice.foco === userId;
  const naTelaCheia = comSom && voice.telaCheia;
  const rotulo = `${nome} · ${modo === "camera" ? "câmera" : "tela"}`;

  let quadro;
  if (naTelaCheia) {
    quadro = (
      <div className="text-muted-foreground flex h-full items-center justify-center text-xs">
        na tela grande
      </div>
    );
  } else if (peer?.hasVideo) {
    quadro = <VideoDoStream stream={peer.stream} />;
  } else if (assistindo) {
    quadro = (
      <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-xs">
        <Loader2 className="size-4 animate-spin" /> abrindo…
      </div>
    );
  } else {
    quadro = (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center">
        <Bottlecap name={nome} src={avatar} className="size-11 text-base" />
        <span className="text-muted-foreground text-[11px] leading-tight">
          {modo === "camera" ? "câmera ligada" : "mostrando a tela"} · clique pra ver
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border transition-colors",
        comSom
          ? "border-primary shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-primary)_25%,transparent)]"
          : "border-border",
        naTelaCheia && "opacity-60",
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="bg-rail hover:border-primary/40 group relative block aspect-video w-full text-left"
            title={`Opções da transmissão de ${nome}`}
          >
            {quadro}
            <span className="bg-background/85 absolute bottom-1.5 left-1.5 max-w-[60%] truncate rounded-md px-1.5 py-0.5 text-[11px] font-medium">
              {rotulo}
            </span>
            {assistindo && !naTelaCheia && (
              <span className="absolute right-1.5 bottom-1.5">
                <SeloDeSom comSom={comSom} />
              </span>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="text-muted-foreground truncate text-xs">
            {rotulo}
          </DropdownMenuLabel>
          {!naTelaCheia && (
            <DropdownMenuItem onSelect={() => voice.abrirEmTelaCheia(userId)}>
              <Maximize2 className="size-4" /> Assistir em tela cheia
            </DropdownMenuItem>
          )}
          {naTelaCheia && (
            <DropdownMenuItem onSelect={voice.sairDaTelaCheia}>
              <Maximize2 className="size-4" /> Voltar pra miniatura
            </DropdownMenuItem>
          )}
          {!comSom ? (
            <DropdownMenuItem onSelect={() => voice.ouvir(userId)}>
              <Volume2 className="size-4" /> Ouvir aqui na miniatura
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={voice.silenciarTelas}>
              <VolumeX className="size-4" /> Tirar o som
            </DropdownMenuItem>
          )}
          {!assistindo && (
            <DropdownMenuItem onSelect={() => voice.assistir(userId)}>
              <Eye className="size-4" /> Só a imagem, sem som
            </DropdownMenuItem>
          )}
          {assistindo && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => voice.pararDeAssistir(userId)}
              >
                <EyeOff className="size-4" /> Parar de assistir
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {comSom && !naTelaCheia && (
        <div className="bg-surface border-border border-t px-1 py-0.5">
          <SomDaTransmissao userId={userId} nome={nome} temAudio={!!peer?.audioDaTela} />
        </div>
      )}
    </div>
  );
}

/**
 * As transmissões da mesa de voz em que você está sentado,
 * em miniatura e sem som, em qualquer tela do buteco — inclusive com você
 * lendo uma mesa de texto. O som só vem da que você escolher.
 */
export function NaTelaAgora({
  names,
  avatars,
  isAdult,
}: {
  names: Record<string, string>;
  avatars: Record<string, string | null>;
  isAdult: boolean;
}) {
  const voice = useVoice();
  const temAlgo = useTemTelaAgora();
  if (!temAlgo) return null;

  const transmissoes = Object.entries(voice.transmissoes);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="border-border flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <span className="bg-neon size-2 rounded-full shadow-[0_0_8px_var(--color-neon)]" />
        <h2 className="font-display text-xl tracking-wide">Na tela agora</h2>
        <span className="text-muted-foreground ml-auto text-xs tabular-nums">
          {transmissoes.length + (voice.localVideoStream ? 1 : 0)}
        </span>
      </header>

      <div className="scrollbar-thin flex flex-1 flex-col gap-3 overflow-y-auto p-3">
        {transmissoes.map(([id, modo]) => (
          <Miniatura
            key={id}
            userId={id}
            nome={names[id] ?? "Participante"}
            avatar={avatars[id]}
            modo={modo}
          />
        ))}

        {voice.localVideoStream && (
          <div className="border-border overflow-hidden rounded-xl border">
            <div className="bg-rail relative aspect-video">
              <VideoDoStream stream={voice.localVideoStream} />
              <span className="bg-background/85 absolute bottom-1.5 left-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium">
                {voice.videoMode === "screen" ? "Sua tela" : "Sua câmera"}
              </span>
            </div>
            <button
              onClick={() =>
                void voice.toggleVideo(voice.videoMode === "screen" ? "screen" : "camera")
              }
              disabled={voice.busy}
              className="bg-surface hover:bg-surface-2 text-muted-foreground hover:text-foreground flex w-full items-center justify-center gap-1.5 py-1.5 text-xs transition-colors disabled:opacity-50"
            >
              {voice.videoMode === "screen" ? (
                <MonitorX className="size-3.5" />
              ) : (
                <Video className="size-3.5" />
              )}
              {voice.videoMode === "screen" ? "Parar de mostrar" : "Desligar a câmera"}
            </button>
          </div>
        )}

        {!voice.localVideoStream && isAdult && (
          <button
            onClick={() => void voice.toggleVideo("screen")}
            disabled={voice.busy}
            className="border-border text-muted-foreground hover:text-foreground hover:border-primary/50 mt-auto flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-dashed text-sm transition-colors disabled:opacity-50"
          >
            <MonitorUp className="size-4" /> Mostrar minha tela
          </button>
        )}
      </div>
    </section>
  );
}
