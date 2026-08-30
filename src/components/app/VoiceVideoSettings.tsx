import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Headphones, Mic, ShieldAlert, Volume2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useMediaPrefs, audioConstraints } from "@/lib/mediaPrefs";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

type Dispositivo = { deviceId: string; label: string };
type Listas = { mics: Dispositivo[]; saidas: Dispositivo[]; cameras: Dispositivo[] };

const VAZIO: Listas = { mics: [], saidas: [], cameras: [] };

/** O medidor satura bem antes do clipping: 0.35 de RMS já é fala alta. */
const RMS_CHEIO = 0.35;

export function VoiceVideoSettings({ ativo }: { ativo: boolean }) {
  const { isAdult } = useAuth();
  const { prefs, setPrefs } = useMediaPrefs();

  const [listas, setListas] = useState<Listas>(VAZIO);
  const [temRotulos, setTemRotulos] = useState(true);
  const [nivel, setNivel] = useState(0);
  const [erro, setErro] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number>(0);

  const carregarDispositivos = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const todos = await navigator.mediaDevices.enumerateDevices();
    const mapear = (kind: MediaDeviceKind, prefixo: string) =>
      todos
        .filter((d) => d.kind === kind)
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `${prefixo} ${i + 1}` }));

    setListas({
      mics: mapear("audioinput", "Microfone"),
      saidas: mapear("audiooutput", "Saída"),
      cameras: mapear("videoinput", "Câmera"),
    });
    // Sem permissão concedida o navegador devolve a lista com os rótulos em
    // branco. É esse o sinal de que precisamos pedir acesso antes de listar.
    setTemRotulos(todos.some((d) => d.label !== ""));
  }, []);

  /** Desliga captura, análise e animação. Chamado ao fechar e ao trocar de mic. */
  const pararMedidor = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close();
    ctxRef.current = null;
    setNivel(0);
  }, []);

  const iniciarMedidor = useCallback(async () => {
    pararMedidor();
    setErro(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(prefs) });
      streamRef.current = stream;

      const AudioCtx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      ctxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      const dados = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        frameRef.current = requestAnimationFrame(tick);
        analyser.getByteTimeDomainData(dados);
        let soma = 0;
        for (let i = 0; i < dados.length; i++) {
          const v = (dados[i]! - 128) / 128;
          soma += v * v;
        }
        const rms = Math.sqrt(soma / dados.length);
        // O ganho de entrada entra na conta: o medidor mostra o que a mesa vai
        // ouvir, não o que o microfone captou antes do slider.
        setNivel(Math.min(1, (rms * prefs.inputGain) / RMS_CHEIO));
      };
      frameRef.current = requestAnimationFrame(tick);

      // Com a permissão concedida agora dá para ler os nomes de verdade.
      await carregarDispositivos();
    } catch {
      setErro("Não consegui abrir o microfone. Confira a permissão do navegador.");
    }
  }, [prefs, pararMedidor, carregarDispositivos]);

  // O medidor só vive enquanto a aba está aberta: nada de microfone ligado em
  // segundo plano depois que a pessoa sai daqui.
  useEffect(() => {
    if (!ativo) {
      pararMedidor();
      return;
    }
    void carregarDispositivos();
    void iniciarMedidor();
    return pararMedidor;
    // iniciarMedidor muda junto com prefs.micId/inputGain, o que é justamente
    // quando queremos reabrir a captura no dispositivo novo.
  }, [ativo, prefs.micId, iniciarMedidor, pararMedidor, carregarDispositivos]);

  // Dispositivo plugado ou removido no meio do caminho.
  useEffect(() => {
    if (!navigator.mediaDevices) return;
    const handler = () => void carregarDispositivos();
    navigator.mediaDevices.addEventListener("devicechange", handler);
    return () => navigator.mediaDevices.removeEventListener("devicechange", handler);
  }, [carregarDispositivos]);

  const seletor = (
    id: string,
    Icone: typeof Mic,
    rotulo: string,
    itens: Dispositivo[],
    valor: string | null,
    aoTrocar: (v: string | null) => void,
    desabilitado?: boolean,
  ) => (
    <div className="space-y-2">
      <Label htmlFor={id} className="flex items-center gap-2">
        <Icone className="size-4" /> {rotulo}
      </Label>
      <select
        id={id}
        disabled={desabilitado}
        value={valor ?? ""}
        onChange={(e) => aoTrocar(e.target.value || null)}
        className={cn(
          "border-border bg-surface-2 h-10 w-full rounded-lg border px-3 text-sm",
          "focus:border-primary focus:outline-none disabled:opacity-50",
        )}
      >
        <option value="">Padrão do sistema</option>
        {itens.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="space-y-6">
      {!temRotulos && (
        <div className="border-border bg-surface-2 space-y-2 rounded-xl border p-3">
          <p className="text-sm">
            O navegador só mostra o nome dos aparelhos depois que você libera o microfone.
          </p>
          <Button size="sm" onClick={() => void iniciarMedidor()}>
            Liberar e listar aparelhos
          </Button>
        </div>
      )}

      {seletor("mic", Mic, "Microfone", listas.mics, prefs.micId, (v) => setPrefs({ micId: v }))}

      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Volume2 className="size-4" /> Teste do microfone
        </Label>
        <div className="border-border bg-surface-2 h-4 overflow-hidden rounded-full border">
          <div
            className="bg-gradient-amber h-full transition-[width] duration-75"
            style={{ width: `${Math.round(nivel * 100)}%` }}
          />
        </div>
        <p className="text-muted-foreground text-xs">
          {erro ?? "Fala alguma coisa: a barra tem que se mexer."}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="ganho">Volume de entrada</Label>
        <Slider
          id="ganho"
          min={0}
          max={200}
          step={5}
          value={[Math.round(prefs.inputGain * 100)]}
          onValueChange={([v]) => setPrefs({ inputGain: (v ?? 100) / 100 })}
        />
        <p className="text-muted-foreground text-xs">
          {Math.round(prefs.inputGain * 100)}% — o quanto o seu microfone chega na mesa.
        </p>
      </div>

      <div className="border-border space-y-6 border-t pt-5">
        {seletor("saida", Headphones, "Saída de áudio", listas.saidas, prefs.speakerId, (v) =>
          setPrefs({ speakerId: v }),
        )}

        <div className="space-y-2">
          <Label htmlFor="volume">Volume de saída</Label>
          <Slider
            id="volume"
            min={0}
            max={100}
            step={5}
            value={[Math.round(prefs.outputVolume * 100)]}
            onValueChange={([v]) => setPrefs({ outputVolume: (v ?? 100) / 100 })}
          />
          <p className="text-muted-foreground text-xs">
            {Math.round(prefs.outputVolume * 100)}% — o quanto você ouve a galera.
          </p>
        </div>
      </div>

      <div className="border-border space-y-2 border-t pt-5">
        {seletor(
          "camera",
          Camera,
          "Câmera",
          listas.cameras,
          prefs.cameraId,
          (v) => setPrefs({ cameraId: v }),
          !isAdult,
        )}
        {!isAdult && (
          <p className="text-neon flex items-center gap-1.5 text-xs">
            <ShieldAlert className="size-3.5" />
            Modo protegido: câmera e tela liberam a partir dos 18.
          </p>
        )}
      </div>
    </div>
  );
}
