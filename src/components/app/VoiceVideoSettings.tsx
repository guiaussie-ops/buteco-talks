import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  Headphones,
  Mic,
  Play,
  ShieldAlert,
  SlidersHorizontal,
  Square,
  Volume2,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useMediaPrefs, audioConstraints } from "@/lib/mediaPrefs";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type Dispositivo = { deviceId: string; label: string };
type Listas = { mics: Dispositivo[]; saidas: Dispositivo[]; cameras: Dispositivo[] };

const VAZIO: Listas = { mics: [], saidas: [], cameras: [] };

/** O medidor satura bem antes do clipping: 0.35 de RMS já é fala alta. */
const RMS_CHEIO = 0.35;

/**
 * O teste se desliga sozinho. É a garantia de que um microfone aberto nunca
 * sobrevive à distração de quem abriu — dois minutos dão folga para ajustar o
 * ganho ouvindo o retorno, e mexer nos controles renova o relógio.
 */
const DURACAO_TESTE_MS = 120_000;

/** Acima disso por um tempo contínuo não é fala, é o retorno se realimentando. */
const RMS_MICROFONIA = 0.5;
const MS_ATE_CORTAR = 1500;

export function VoiceVideoSettings({ ativo }: { ativo: boolean }) {
  const { isAdult } = useAuth();
  const { prefs, setPrefs } = useMediaPrefs();

  const [listas, setListas] = useState<Listas>(VAZIO);
  const [temRotulos, setTemRotulos] = useState(true);
  const [nivel, setNivel] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [testando, setTestando] = useState(false);
  const [retorno, setRetorno] = useState(true);
  const [microfonia, setMicrofonia] = useState(false);
  const [restante, setRestante] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number>(0);
  /** Ganho do retorno; mexer nele não reabre a captura. */
  const ganhoRef = useRef<GainNode | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** Quando o teste se auto-desliga. */
  const fimRef = useRef(0);
  /** Desde quando o nível está saturado, para o corta-microfonia. */
  const saturadoDesdeRef = useRef(0);

  // As prefs entram por ref no laço de análise e na captura: sem isso, arrastar
  // qualquer slider recriava o callback e derrubava o microfone no meio do teste.
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const retornoRef = useRef(retorno);
  retornoRef.current = retorno;
  const testandoRef = useRef(testando);
  testandoRef.current = testando;

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

  /** Larga microfone, retorno, análise e animação. */
  const pararTeste = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.srcObject = null;
    }
    ganhoRef.current = null;
    void ctxRef.current?.close();
    ctxRef.current = null;
    saturadoDesdeRef.current = 0;
    fimRef.current = 0;
    setNivel(0);
    setRestante(0);
    setTestando(false);
  }, []);

  /** Empurra a auto-parada para frente — quem está ajustando ainda está usando. */
  const renovarTeste = useCallback(() => {
    if (testandoRef.current) fimRef.current = Date.now() + DURACAO_TESTE_MS;
  }, []);

  const iniciarTeste = useCallback(async () => {
    pararTeste();
    setErro(null);
    setMicrofonia(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints(prefsRef.current),
      });
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

      // Retorno: sai por um <audio> em vez de ir direto ao ctx.destination
      // porque só assim dá para respeitar a saída escolhida com setSinkId, do
      // mesmo jeito que o áudio da mesa faz. Começa em zero e sobe na rampa do
      // efeito abaixo, para não estourar no primeiro quadro.
      const ganho = ctx.createGain();
      ganho.gain.value = 0;
      const destino = ctx.createMediaStreamDestination();
      source.connect(ganho);
      ganho.connect(destino);
      ganhoRef.current = ganho;
      if (audioRef.current) {
        audioRef.current.srcObject = destino.stream;
        void audioRef.current.play().catch(() => undefined);
      }

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
        setNivel(Math.min(1, (rms * prefsRef.current.inputGain) / RMS_CHEIO));

        // Corta-microfonia: nível colado no teto por tempo contínuo com o
        // retorno ligado é o loop se realimentando, não alguém falando alto.
        if (retornoRef.current && rms > RMS_MICROFONIA) {
          const agora = performance.now();
          if (!saturadoDesdeRef.current) saturadoDesdeRef.current = agora;
          else if (agora - saturadoDesdeRef.current > MS_ATE_CORTAR) setMicrofonia(true);
        } else {
          saturadoDesdeRef.current = 0;
        }
      };
      frameRef.current = requestAnimationFrame(tick);

      fimRef.current = Date.now() + DURACAO_TESTE_MS;
      setRestante(Math.round(DURACAO_TESTE_MS / 1000));
      setTestando(true);

      // Com a permissão concedida agora dá para ler os nomes de verdade.
      await carregarDispositivos();
    } catch {
      pararTeste();
      setErro("Não consegui abrir o microfone. Confira a permissão do navegador.");
    }
  }, [pararTeste, carregarDispositivos]);

  /** Permissão de uma vez só, para descobrir os nomes dos aparelhos. */
  const liberarAparelhos = useCallback(async () => {
    setErro(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Fecha na hora: aqui a gente só queria o direito de ler os rótulos.
      stream.getTracks().forEach((t) => t.stop());
      await carregarDispositivos();
    } catch {
      setErro("Não consegui abrir o microfone. Confira a permissão do navegador.");
    }
  }, [carregarDispositivos]);

  // Relógio da auto-parada.
  useEffect(() => {
    if (!testando) return;
    const id = window.setInterval(() => {
      const s = Math.max(0, Math.ceil((fimRef.current - Date.now()) / 1000));
      setRestante(s);
      if (s === 0) pararTeste();
    }, 250);
    return () => window.clearInterval(id);
  }, [testando, pararTeste]);

  // Volume do retorno, ao vivo. Rampa curta em vez de salto evita o estalo.
  useEffect(() => {
    const ganho = ganhoRef.current;
    const ctx = ctxRef.current;
    if (!ganho || !ctx) return;
    const alvo = retorno && !microfonia ? prefs.inputGain * prefs.outputVolume : 0;
    ganho.gain.setTargetAtTime(alvo, ctx.currentTime, 0.02);
  }, [retorno, microfonia, prefs.inputGain, prefs.outputVolume, testando]);

  // Saída escolhida para o retorno. setSinkId não existe em todo navegador;
  // sem ele o retorno sai no aparelho padrão — degrada, não quebra.
  useEffect(() => {
    const el = audioRef.current as
      (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!el?.setSinkId || !prefs.speakerId) return;
    void el.setSinkId(prefs.speakerId).catch(() => undefined);
  }, [prefs.speakerId, testando]);

  // O que só pode mudar reabrindo a captura: o aparelho e os filtros do
  // navegador. Ganho e volume continuam entrando ao vivo, sem derrubar o
  // microfone — era esse o bug de arrastar qualquer slider.
  const assinaturaDaCaptura = [
    prefs.micId,
    prefs.echoCancellation,
    prefs.noiseSuppression,
    prefs.autoGainControl,
  ].join("|");
  const capturaAnteriorRef = useRef(assinaturaDaCaptura);
  useEffect(() => {
    if (capturaAnteriorRef.current === assinaturaDaCaptura) return;
    capturaAnteriorRef.current = assinaturaDaCaptura;
    if (testandoRef.current) void iniciarTeste();
  }, [assinaturaDaCaptura, iniciarTeste]);

  // Fechar as configurações (ou desmontar) sempre larga o microfone.
  useEffect(() => {
    if (!ativo) pararTeste();
    return pararTeste;
  }, [ativo, pararTeste]);

  // Lista os aparelhos sem pedir nada: os nomes só aparecem se a permissão já
  // tiver sido dada antes.
  useEffect(() => {
    if (ativo) void carregarDispositivos();
  }, [ativo, carregarDispositivos]);

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
        onChange={(e) => {
          renovarTeste();
          aoTrocar(e.target.value || null);
        }}
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

  const interruptor = (
    id: string,
    rotulo: string,
    valor: boolean,
    aoTrocar: (v: boolean) => void,
    explicacao: string,
    aviso?: string,
  ) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id} className="text-sm font-normal">
          {rotulo}
        </Label>
        <Switch
          id={id}
          checked={valor}
          onCheckedChange={(v) => {
            renovarTeste();
            aoTrocar(v);
          }}
        />
      </div>
      <p className="text-muted-foreground text-xs">{explicacao}</p>
      {!valor && aviso && (
        <p className="text-warning flex items-start gap-1.5 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {aviso}
        </p>
      )}
    </div>
  );

  const dica = () => {
    if (erro) return erro;
    if (!testando) return "Aperte testar e fala alguma coisa: a barra tem que se mexer.";
    if (microfonia)
      return "Cortei o retorno: isso aí é microfonia. Põe o fone de ouvido e ligue de novo.";
    return "Fala alguma coisa: a barra tem que se mexer.";
  };

  return (
    <div className="space-y-6">
      {/* Retorno do teste. Fica fora do bloco condicional para o ref já existir
          quando o áudio começa a tocar. */}
      <audio ref={audioRef} autoPlay playsInline className="hidden" />

      {!temRotulos && (
        <div className="border-border bg-surface-2 space-y-2 rounded-xl border p-3">
          <p className="text-sm">
            O navegador só mostra o nome dos aparelhos depois que você libera o microfone.
          </p>
          <Button size="sm" onClick={() => void liberarAparelhos()}>
            Liberar e listar aparelhos
          </Button>
        </div>
      )}

      {seletor("mic", Mic, "Microfone", listas.mics, prefs.micId, (v) => setPrefs({ micId: v }))}

      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Volume2 className="size-4" /> Teste do microfone
        </Label>

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant={testando ? "destructive" : "default"}
            onClick={() => (testando ? pararTeste() : void iniciarTeste())}
          >
            {testando ? <Square className="size-4" /> : <Play className="size-4" />}
            {testando ? `Parar teste (${restante}s)` : "Testar microfone"}
          </Button>
          <div className="border-border bg-surface-2 h-4 flex-1 overflow-hidden rounded-full border">
            <div
              className="bg-gradient-amber h-full transition-[width] duration-75"
              style={{ width: `${Math.round(nivel * 100)}%` }}
            />
          </div>
        </div>

        <p className={cn("text-xs", microfonia ? "text-warning" : "text-muted-foreground")}>
          {dica()}
        </p>

        {testando && (
          <div className="border-border bg-surface-2 space-y-2 rounded-xl border p-3">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="retorno" className="flex items-center gap-2 text-sm">
                <Headphones className="size-4" /> Ouvir minha voz de volta
              </Label>
              <Switch
                id="retorno"
                checked={retorno && !microfonia}
                onCheckedChange={(v) => {
                  renovarTeste();
                  setMicrofonia(false);
                  setRetorno(v);
                }}
              />
            </div>
            <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              Use fone de ouvido. Sem fone, o retorno volta para o microfone e apita — se isso
              acontecer, eu corto sozinho.
            </p>
          </div>
        )}
      </div>

      <div className="border-border space-y-4 border-t pt-5">
        <Label className="flex items-center gap-2">
          <SlidersHorizontal className="size-4" /> Filtros do microfone
        </Label>
        <p className="text-muted-foreground -mt-2 text-xs">
          Tratamento que o próprio navegador faz na captura. Na dúvida, deixe os três ligados.
        </p>

        {interruptor(
          "ruido",
          "Reduzir ruído de fundo",
          prefs.noiseSuppression,
          (v) => setPrefs({ noiseSuppression: v }),
          "Segura ventilador, ar-condicionado e chiado constante.",
        )}
        {interruptor(
          "eco",
          "Cancelamento de eco",
          prefs.echoCancellation,
          (v) => setPrefs({ echoCancellation: v }),
          "Impede que o som da mesa saindo pela caixa volte pelo seu microfone.",
          "Sem fone de ouvido, desligar isto devolve o eco para a mesa inteira.",
        )}
        {interruptor(
          "agc",
          "Ajuste automático de volume",
          prefs.autoGainControl,
          (v) => setPrefs({ autoGainControl: v }),
          "Empareja o volume: levanta quem fala baixo, segura quem grita.",
          "Desligado, quem fala baixo chega baixo na mesa — compense no volume de entrada.",
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="ganho">Volume de entrada</Label>
        <Slider
          id="ganho"
          min={0}
          max={200}
          step={5}
          value={[Math.round(prefs.inputGain * 100)]}
          onValueChange={([v]) => {
            renovarTeste();
            setPrefs({ inputGain: (v ?? 100) / 100 });
          }}
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
            onValueChange={([v]) => {
              renovarTeste();
              setPrefs({ outputVolume: (v ?? 100) / 100 });
            }}
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
