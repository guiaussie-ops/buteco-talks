import { Mic, MicOff, MonitorUp, MonitorX, PhoneOff, Volume2 } from "lucide-react";
import { useVoice } from "@/lib/voice";
import { cn } from "@/lib/utils";

/**
 * Barra de "voz ativa". Fica visível enquanto houver mesa conectada,
 * independente do canal que estiver aberto na tela.
 */
export function VoiceBar({ onOpenRoom }: { onOpenRoom?: (channelId: string) => void }) {
  const voice = useVoice();
  if (!voice.active) return null;

  const sharing = voice.videoMode === "screen";

  return (
    <div className="border-border bg-surface wood-texture border-t px-3 py-2">
      <button
        type="button"
        onClick={() => onOpenRoom?.(voice.active!.channelId)}
        className="mb-2 flex w-full items-center gap-2 text-left"
        title="Ir para a mesa"
      >
        <Volume2
          className={cn(
            "size-4 shrink-0",
            voice.connected ? "text-primary" : "text-muted-foreground",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{voice.active.channelName}</span>
          <span className="text-muted-foreground block text-[11px]">
            {voice.connected ? `Na mesa · ${voice.participantCount}` : "conectando..."}
          </span>
        </span>
      </button>

      <div className="flex items-center gap-1.5">
        <button
          onClick={voice.toggleMic}
          title={voice.micOn ? "Mutar" : "Desmutar"}
          className={cn(
            "flex flex-1 items-center justify-center rounded-md py-1.5 transition-colors",
            voice.micOn
              ? "bg-muted/40 hover:bg-muted text-foreground"
              : "bg-destructive/20 text-destructive hover:bg-destructive/30",
          )}
        >
          {voice.micOn ? <Mic className="size-4" /> : <MicOff className="size-4" />}
        </button>
        <button
          onClick={() => void voice.toggleVideo("screen")}
          disabled={voice.busy}
          title={sharing ? "Parar de mostrar a tela" : "Mostrar tela"}
          className={cn(
            "flex flex-1 items-center justify-center rounded-md py-1.5 transition-colors disabled:opacity-50",
            sharing
              ? "bg-primary/20 text-primary hover:bg-primary/30"
              : "bg-muted/40 hover:bg-muted text-foreground",
          )}
        >
          {sharing ? <MonitorX className="size-4" /> : <MonitorUp className="size-4" />}
        </button>
        <button
          onClick={voice.leave}
          title="Sair da mesa"
          className="bg-destructive/20 text-destructive hover:bg-destructive/30 flex flex-1 items-center justify-center rounded-md py-1.5 transition-colors"
        >
          <PhoneOff className="size-4" />
        </button>
      </div>
    </div>
  );
}
