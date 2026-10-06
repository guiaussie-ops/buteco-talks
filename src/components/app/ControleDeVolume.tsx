import type { ReactNode } from "react";
import { MessageCircle, MicOff, UserRound, Volume2, VolumeX } from "lucide-react";
import { usePerfil } from "@/lib/perfil";
import { useConversas } from "@/lib/conversas";
import { useVoice } from "@/lib/voice";
import { AUDIO_DO_PARTICIPANTE_PADRAO } from "@/lib/mediaPrefs";
import { VOLUME_MAXIMO } from "@/lib/saidaDeAudio";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

/** O slider vai até aqui. 100% é o volume original; acima disso, ver o aviso no popover. */
const PERCENT_MAXIMO = VOLUME_MAXIMO * 100;

/** Volume e mudo de um participante, do seu ponto de vista. */
export function useAudioDoParticipante(userId: string) {
  const voice = useVoice();
  const atual = voice.peerAudio[userId] ?? AUDIO_DO_PARTICIPANTE_PADRAO;
  return {
    percent: Math.round(atual.volume * 100),
    muted: atual.muted,
    definir: (p: number) => voice.setPeerVolume(userId, p / 100),
    alternarMudo: () => voice.togglePeerMute(userId),
  };
}

/** Marca discreta de "esta pessoa está muda pra mim". */
export function SeloDeMudo({ className }: { className?: string }) {
  return <VolumeX className={cn("text-muted-foreground/70 shrink-0", className)} />;
}

/** Marca de "esta pessoa está com o microfone fechado" — isso ela publicou. */
export function SeloDeMicFechado({ className }: { className?: string }) {
  return <MicOff className={cn("text-muted-foreground/70 shrink-0", className)} />;
}

/**
 * Volume de uma pessoa só, para quem está ouvindo — não mexe no que ela envia.
 *
 * Tudo aqui é ESTRITAMENTE LOCAL: o que você escolhe vai para o seu
 * localStorage e para o seu grafo de saída, e para mais lugar nenhum. A pessoa
 * mutada não é avisada, e o resto da mesa continua ouvindo ela normalmente.
 *
 * Envolve o que for passado como filho e abre no clique, nunca no hover: no
 * celular não existe hover. Vive nos dois lugares em que a tampinha aparece,
 * a barra lateral e o painel da mesa.
 */
export function ControleDeVolume({
  userId,
  name,
  className,
  align = "center",
  children,
}: {
  userId: string;
  name: string;
  className?: string;
  align?: "start" | "center" | "end";
  children: ReactNode;
}) {
  const { percent, muted, definir, alternarMudo } = useAudioDoParticipante(userId);
  const { abrirPerfil } = usePerfil();
  const { abrirConversa } = useConversas();
  // O som da tela de alguém usa o mesmo controle, com a chave "tela:<id>";
  // esse não tem perfil para abrir.
  const pessoa = userId.startsWith("tela:") ? null : userId;

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
          className,
        )}
        aria-label={`Volume de ${name}: ${muted ? "mudo" : `${percent}%`}`}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-60 space-y-2 p-3">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{name}</p>
          <button
            type="button"
            onClick={alternarMudo}
            aria-pressed={muted}
            title={muted ? `Voltar a ouvir ${name}` : `Não ouvir ${name}`}
            className={cn(
              "rounded-md p-1.5 transition-colors",
              muted
                ? "bg-destructive/20 text-destructive hover:bg-destructive/30"
                : "hover:bg-muted text-muted-foreground",
            )}
          >
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </button>
        </div>

        <Slider
          min={0}
          max={PERCENT_MAXIMO}
          step={5}
          value={[muted ? 0 : percent]}
          onValueChange={([v]) => definir(v ?? 100)}
          aria-label={`Volume de ${name}`}
        />

        <p className="text-muted-foreground text-xs">
          {muted ? (
            `Mudo pra você — ${name} não sabe disso.`
          ) : percent > 100 ? (
            <>
              {percent}% — só pra você.{" "}
              <span className="text-warning">Acima de 100% amplifica a voz.</span>
            </>
          ) : (
            `${percent}% — só pra você.`
          )}
        </p>

        {pessoa && (
          <div className="-mx-1 flex flex-col">
            <button
              type="button"
              onClick={() => abrirPerfil(pessoa)}
              className="hover:bg-muted text-muted-foreground hover:text-foreground flex items-center gap-2 rounded-md px-1 py-1.5 text-left text-xs transition-colors"
            >
              <UserRound className="size-3.5" /> Ver o perfil de {name}
            </button>
            <button
              type="button"
              onClick={() => abrirConversa(pessoa)}
              className="hover:bg-muted text-muted-foreground hover:text-foreground flex items-center gap-2 rounded-md px-1 py-1.5 text-left text-xs transition-colors"
            >
              <MessageCircle className="size-3.5" /> Conversar com {name}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
