import { useEffect, useRef } from "react";
import { EyeOff, Loader2, Minimize2, Volume2, VolumeX } from "lucide-react";
import { chaveDaTela, useVoice } from "@/lib/voice";
import { Button } from "@/components/ui/button";
import { ControleDeVolume, useAudioDoParticipante } from "@/components/app/ControleDeVolume";
import { cn } from "@/lib/utils";

/**
 * Um <video> preso a um stream. SEMPRE mudo, e isto não é detalhe de estilo.
 *
 * O stream que chega de um participante carrega a voz e o vídeo dele juntos. Um
 * <video> sem `muted` toca esse áudio por conta própria, no volume dele — em
 * paralelo com o grafo de saída, que é quem o slider controla. Era exatamente
 * esse o bug do "slider anda e o volume não muda".
 *
 * A voz e o som da tela de todo mundo saem por um caminho só: `saidaDeAudio`.
 * Aqui é imagem.
 */
export function VideoDoStream({ stream, className }: { stream: MediaStream; className?: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    // Largar o srcObject é o que solta a referência ao stream (e o decoder de
    // vídeo junto) quando o quadro sai da tela.
    return () => {
      el.srcObject = null;
    };
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={cn("h-full w-full bg-black object-contain", className)}
    />
  );
}

/**
 * Volume do som da transmissão, separado do volume da voz da pessoa. Dá para
 * deixar o jogo baixinho e a voz alta.
 */
export function SomDaTransmissao({
  userId,
  nome,
  temAudio,
  className,
}: {
  userId: string;
  nome: string;
  temAudio: boolean;
  className?: string;
}) {
  const { muted, percent } = useAudioDoParticipante(chaveDaTela(userId));
  if (!temAudio) {
    return (
      <span
        className={cn("text-muted-foreground flex items-center gap-1.5 text-xs", className)}
        title="Quem transmite não marcou “compartilhar áudio”, ou é câmera"
      >
        <VolumeX className="size-3.5" /> transmissão sem áudio
      </span>
    );
  }
  return (
    <ControleDeVolume
      userId={chaveDaTela(userId)}
      name={`Som da tela de ${nome}`}
      align="start"
      className={cn(
        "hover:bg-surface-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors",
        className,
      )}
    >
      {muted ? <VolumeX className="size-4" /> : <Volume2 className="text-primary size-4" />}
      {muted ? "som da tela mudo" : `som da tela · ${percent}%`}
    </ControleDeVolume>
  );
}

/**
 * A transmissão escolhida, no centro da tela, com som. Sai daqui de dois
 * jeitos: de volta para a miniatura (o som continua) ou parando de assistir.
 */
export function TelaCheia({ names }: { names: Record<string, string> }) {
  const voice = useVoice();
  const id = voice.foco;
  if (!id) return null;
  const peer = voice.remotePeers.find((p) => p.userId === id && p.hasVideo);
  const nome = names[id] ?? "Participante";
  const modo = voice.transmissoes[id];

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-black/40">
      <header className="border-border flex h-14 shrink-0 items-center gap-3 border-b px-5">
        <span className="bg-neon size-2 rounded-full shadow-[0_0_8px_var(--color-neon)]" />
        <h1 className="font-display truncate text-xl tracking-wide">
          {nome} · {modo === "camera" ? "câmera" : "tela"}
        </h1>
        <div className="ml-auto flex shrink-0 gap-2">
          <Button size="sm" variant="secondary" onClick={voice.sairDaTelaCheia}>
            <Minimize2 className="size-4" /> Voltar pra miniatura
          </Button>
          <Button
            size="sm"
            className="bg-neon text-neon-foreground hover:bg-neon/90"
            onClick={() => voice.pararDeAssistir(id)}
          >
            <EyeOff className="size-4" /> Parar de assistir
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="border-primary/50 relative min-h-0 flex-1 overflow-hidden rounded-xl border-2 bg-black">
          {peer ? (
            <VideoDoStream stream={peer.stream} />
          ) : (
            <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 text-sm">
              <Loader2 className="text-primary size-6 animate-spin" />
              Abrindo a transmissão de {nome}…
            </div>
          )}
        </div>
        <div className="border-border bg-surface flex shrink-0 items-center gap-3 rounded-lg border px-3 py-2">
          <SomDaTransmissao userId={id} nome={nome} temAudio={!!peer?.audioDaTela} />
          <span className="text-muted-foreground ml-auto hidden text-xs sm:block">
            a voz de {nome} segue no volume dela, separado
          </span>
        </div>
      </div>
    </section>
  );
}
