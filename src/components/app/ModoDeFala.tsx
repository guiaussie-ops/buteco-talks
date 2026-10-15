import { useEffect, useState } from "react";
import { AlertTriangle, Keyboard } from "lucide-react";
import { useMediaPrefs } from "@/lib/mediaPrefs";
import { ATRASO_PTT_MAXIMO_MS, codeDoMouse, rotuloDaTecla, teclaPermitida } from "@/lib/pushToTalk";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

/**
 * Detecção de voz ou aperte-para-falar, a tecla e o atraso ao soltar. Cada
 * pessoa escolhe o seu; quando o modo rádio existir, a sala vai poder impor o
 * PTT por cima disto.
 */
export function ModoDeFala() {
  const { prefs, setPrefs } = useMediaPrefs();
  const [escutando, setEscutando] = useState(false);
  const [recusada, setRecusada] = useState<string | null>(null);

  // Esperando a próxima tecla. Na fase de captura da janela, antes de tudo: é
  // o que impede o Esc de fechar o diálogo e a letra de cair em algum campo.
  useEffect(() => {
    if (!escutando) return;
    const escolher = (code: string, key?: string) => {
      if (!teclaPermitida(code)) {
        setRecusada(rotuloDaTecla(code, key));
        return;
      }
      setRecusada(null);
      setPrefs({ teclaPtt: { code, rotulo: rotuloDaTecla(code, key) } });
      setEscutando(false);
    };
    const aoApertar = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        setRecusada(null);
        setEscutando(false);
        return;
      }
      escolher(e.code, e.key);
    };
    const aoApertarMouse = (e: MouseEvent) => {
      const code = codeDoMouse(e.button);
      if (!code) return;
      e.preventDefault();
      e.stopPropagation();
      escolher(code);
    };
    // O "voltar" do mouse dispara no soltar: segurar ele aqui também.
    const aoSoltarMouse = (e: MouseEvent) => {
      if (codeDoMouse(e.button)) e.preventDefault();
    };
    window.addEventListener("keydown", aoApertar, true);
    window.addEventListener("mousedown", aoApertarMouse, true);
    window.addEventListener("mouseup", aoSoltarMouse, true);
    return () => {
      window.removeEventListener("keydown", aoApertar, true);
      window.removeEventListener("mousedown", aoApertarMouse, true);
      window.removeEventListener("mouseup", aoSoltarMouse, true);
    };
  }, [escutando, setPrefs]);

  const ptt = prefs.modoDeFala === "ptt";

  const opcao = (valor: "voz" | "ptt", rotulo: string) => (
    <button
      type="button"
      aria-pressed={prefs.modoDeFala === valor}
      onClick={() => setPrefs({ modoDeFala: valor })}
      className={cn(
        "flex-1 rounded-lg border px-3 py-2 text-sm transition-colors",
        prefs.modoDeFala === valor
          ? "border-primary bg-primary/15 text-foreground"
          : "border-border bg-surface-2 text-muted-foreground hover:text-foreground",
      )}
    >
      {rotulo}
    </button>
  );

  return (
    <div className="border-border space-y-4 border-t pt-5">
      <Label className="flex items-center gap-2">
        <Keyboard className="size-4" /> Modo de entrada
      </Label>
      <div className="flex gap-2">
        {opcao("voz", "Detecção de voz")}
        {opcao("ptt", "Aperte para falar")}
      </div>
      <p className="text-muted-foreground -mt-2 text-xs">
        {ptt
          ? "O microfone só manda som enquanto você segura a tecla. Para a mesa você continua de microfone aberto — só fica quieto."
          : "O microfone fica aberto e a IA e o gate cuidam do barulho. É o de sempre."}
      </p>

      {ptt && (
        <>
          <div className="space-y-2">
            <Label>Tecla</Label>
            <div className="flex items-center gap-3">
              <kbd className="border-border bg-surface-2 min-w-12 rounded-md border px-3 py-1.5 text-center font-mono text-sm">
                {escutando ? "…" : prefs.teclaPtt.rotulo}
              </kbd>
              <Button
                size="sm"
                variant={escutando ? "default" : "secondary"}
                onClick={() => {
                  setRecusada(null);
                  setEscutando((v) => !v);
                }}
              >
                {escutando ? "Aperte a tecla… (Esc cancela)" : "Trocar tecla"}
              </Button>
            </div>
            {recusada && (
              <p className="text-warning flex items-start gap-1.5 text-xs">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {recusada} não dá: ela já tem outro trabalho no navegador. Tente outra.
              </p>
            )}
            <p className="text-muted-foreground text-xs">
              Vale tecla do teclado ou os botões laterais do mouse. Uma tecla de letra não abre o
              microfone enquanto você digita no chat; F1–F12, Ctrl e Alt abrem até digitando.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="atraso-ptt">Atraso ao soltar</Label>
            <Slider
              id="atraso-ptt"
              min={0}
              max={ATRASO_PTT_MAXIMO_MS}
              step={20}
              value={[prefs.atrasoPttMs]}
              onValueChange={([v]) => setPrefs({ atrasoPttMs: v ?? 0 })}
            />
            <p className="text-muted-foreground text-xs">
              {prefs.atrasoPttMs} ms — quanto o microfone segura aberto depois que você solta, para
              não cortar o fim da última palavra.
            </p>
          </div>

          <p className="text-warning flex items-start gap-1.5 text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />O navegador só entrega a tecla
            para a aba que está na frente. Com o Buteco minimizado ou atrás de um jogo, apertar não
            abre o microfone.
          </p>
        </>
      )}
    </div>
  );
}
