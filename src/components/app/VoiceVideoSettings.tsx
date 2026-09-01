import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  Headphones,
  Mic,
  Play,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Square,
  Volume2,
  Waves,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useMediaPrefs, audioConstraints } from "@/lib/mediaPrefs";
import { LIMIAR_MAXIMO, RMS_CHEIO, ponteDeGate, type PonteDeGate } from "@/lib/gateDeRuido";
import {
  TAXA_DO_MODELO,
  ponteDeSupressor,
  type EstadoDoSupressor,
  type PonteDeSupressor,
} from "@/lib/supressorDeRuido";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type Dispositivo = { deviceId: string; label: string };
type Listas = { mics: Dispositivo[]; saidas: Dispositivo[]; cameras: Dispositivo[] };

const VAZIO: Listas = { mics: [], saidas: [], cameras: [] };

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
  /** Nível depois da IA, para o A/B: é a barra que tem que encolher. */
  const [nivelIA, setNivelIA] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [testando, setTestando] = useState(false);
  const [retorno, setRetorno] = useState(true);
  const [microfonia, setMicrofonia] = useState(false);
  const [restante, setRestante] = useState(0);
  /** O gate está deixando passar agora? Vem do worklet, para a barra mostrar. */
  const [gateAberto, setGateAberto] = useState(true);
  const [semWorklet, setSemWorklet] = useState(false);
  /** O que a supressão por IA está fazendo agora, para a UI não mentir. */
  const [estadoIA, setEstadoIA] = useState<EstadoDoSupressor>("desligado");

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number>(0);
  /**
   * Ganho de entrada do teste. Existe separado do retorno porque o gate precisa
   * ver o sinal já com o volume de entrada aplicado — é assim que ele funciona
   * na mesa, e é o que faz o limiar cair na mesma escala do medidor.
   */
  const ganhoEntradaRef = useRef<GainNode | null>(null);
  /** Ganho do retorno; mexer nele não reabre a captura. */
  const ganhoRef = useRef<GainNode | null>(null);
  /** Gate de ruído do teste, com o mesmo limiar que vale na mesa. */
  const ponteRef = useRef<PonteDeGate | null>(null);
  /** Supressão por IA do teste, no mesmo lugar do grafo que vale na mesa. */
  const ponteIARef = useRef<PonteDeSupressor | null>(null);
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
    // Antes do close(): as pontes ainda mexem nas conexões ao se desfazer.
    ponteIARef.current?.destruir();
    ponteIARef.current = null;
    ponteRef.current?.destruir();
    ponteRef.current = null;
    ganhoEntradaRef.current = null;
    ganhoRef.current = null;
    void ctxRef.current?.close();
    ctxRef.current = null;
    saturadoDesdeRef.current = 0;
    fimRef.current = 0;
    setGateAberto(true);
    setEstadoIA("desligado");
    setNivel(0);
    setNivelIA(0);
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
      // O teste abre SEMPRE em 48 kHz, que é a taxa do modelo. Assim ligar e
      // desligar a IA é instantâneo — e comparar A com B só vale se a troca for
      // no mesmo fôlego. A mesa só força a taxa quando a IA está ligada, mas a
      // diferença é uma reamostragem: o que a pessoa ouve aqui é o que vai ao ar.
      let ctx: AudioContext;
      try {
        ctx = new AudioCtx({ sampleRate: TAXA_DO_MODELO });
      } catch {
        ctx = new AudioCtx();
      }
      ctxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      const dados = new Uint8Array(analyser.frequencyBinCount);

      // O caminho do retorno é o mesmo da mesa: entrada → ganho → [gate] →
      // saída. Calibrar num grafo diferente do que vai ao ar não calibraria nada.
      const ganhoEntrada = ctx.createGain();
      ganhoEntrada.gain.value = prefsRef.current.inputGain;
      source.connect(ganhoEntrada);
      ganhoEntradaRef.current = ganhoEntrada;

      // Emenda entre os dois processadores opcionais, igualzinho à mesa: cada
      // ponte mexe só no próprio trecho, então ligar um nunca desconecta o outro.
      const meio = ctx.createGain();
      ganhoEntrada.connect(meio);

      // Segundo medidor, pendurado na saída da IA. É a barra que tem que
      // encolher quando você faz barulho sem falar — o A/B, em imagem.
      const analiseIA = ctx.createAnalyser();
      analiseIA.fftSize = 512;
      analiseIA.smoothingTimeConstant = 0.5;
      meio.connect(analiseIA);
      const dadosIA = new Uint8Array(analiseIA.frequencyBinCount);

      // Retorno: sai por um <audio> em vez de ir direto ao ctx.destination
      // porque só assim dá para respeitar a saída escolhida com setSinkId, do
      // mesmo jeito que o áudio da mesa faz. Começa em zero e sobe na rampa do
      // efeito abaixo, para não estourar no primeiro quadro.
      const ganho = ctx.createGain();
      ganho.gain.value = 0;
      const destino = ctx.createMediaStreamDestination();
      meio.connect(ganho);
      ganho.connect(destino);
      ganhoRef.current = ganho;

      // `entrada → [IA] → meio → [gate] → retorno`, a mesma ordem da mesa.
      const ponteIA = ponteDeSupressor(ctx, ganhoEntrada, meio, setEstadoIA);
      ponteIARef.current = ponteIA;
      ponteIA.sincronizar(prefsRef.current.noiseSuppressionIA);

      // O gate roda mesmo com o retorno mudo: é dele que vem o aberto/fechado
      // da barra.
      const ponte = ponteDeGate(ctx, meio, ganho, setGateAberto);
      ponteRef.current = ponte;
      ponte.sincronizar(prefsRef.current.noiseGate, prefsRef.current.noiseGateThreshold);
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

        // A barra da IA já vem depois do ganho, então não multiplica de novo.
        analiseIA.getByteTimeDomainData(dadosIA);
        let somaIA = 0;
        for (let i = 0; i < dadosIA.length; i++) {
          const v = (dadosIA[i]! - 128) / 128;
          somaIA += v * v;
        }
        setNivelIA(Math.min(1, Math.sqrt(somaIA / dadosIA.length) / RMS_CHEIO));

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
  // O volume de entrada entra antes do gate; o de saída, depois — os dois sem
  // reabrir a captura.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ganhoEntradaRef.current?.gain.setTargetAtTime(prefs.inputGain, ctx.currentTime, 0.02);
    const alvo = retorno && !microfonia ? prefs.outputVolume : 0;
    ganhoRef.current?.gain.setTargetAtTime(alvo, ctx.currentTime, 0.02);
  }, [retorno, microfonia, prefs.inputGain, prefs.outputVolume, testando]);

  // Ligar, desligar e arrastar o limiar valem no meio do teste — é para isso que
  // a calibração serve. Desligar volta ao caminho sem gate na hora.
  useEffect(() => {
    ponteRef.current?.sincronizar(prefs.noiseGate, prefs.noiseGateThreshold);
  }, [prefs.noiseGate, prefs.noiseGateThreshold, testando]);

  // O A/B da IA: ligar e desligar vale no meio do teste, sem reabrir o
  // microfone e sem cortar o retorno. É assim que dá para comparar de verdade.
  useEffect(() => {
    ponteIARef.current?.sincronizar(prefs.noiseSuppressionIA);
  }, [prefs.noiseSuppressionIA, testando]);

  // Navegador sem AudioWorklet: o gate não tem onde rodar. Só dá para saber no
  // cliente, então fica num efeito para não divergir do HTML do servidor.
  useEffect(() => {
    setSemWorklet(typeof window.AudioWorkletNode === "undefined");
  }, []);

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
    desabilitado?: boolean,
  ) => (
    <div className={cn("space-y-1", desabilitado && "opacity-60")}>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id} className="text-sm font-normal">
          {rotulo}
        </Label>
        <Switch
          id={id}
          checked={valor}
          disabled={desabilitado}
          onCheckedChange={(v) => {
            renovarTeste();
            aoTrocar(v);
          }}
        />
      </div>
      <p className="text-muted-foreground text-xs">{explicacao}</p>
      {!valor && !desabilitado && aviso && (
        <p className="text-warning flex items-start gap-1.5 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {aviso}
        </p>
      )}
    </div>
  );

  /** Com o gate ligado e segurando o som, a barra é desenhada apagada. */
  const gateSegurando = testando && prefs.noiseGate && !semWorklet && !gateAberto;

  const dica = () => {
    if (erro) return erro;
    if (!testando) return "Aperte testar e fala alguma coisa: a barra tem que se mexer.";
    if (microfonia)
      return "Cortei o retorno: isso aí é microfonia. Põe o fone de ouvido e ligue de novo.";
    if (prefs.noiseSuppressionIA && estadoIA === "carregando") return "Baixando o modelo…";
    if (prefs.noiseSuppressionIA && estadoIA === "ligado")
      return "Faz barulho sem falar: a barra de baixo tem que encolher. Falando, as duas sobem junto.";
    if (prefs.noiseGate && !semWorklet)
      return "Fala alguma coisa: a barra tem que passar da linha. Respirando, tem que ficar aquém.";
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
          <div className="flex-1 space-y-1.5">
            <div className="border-border bg-surface-2 relative h-4 overflow-hidden rounded-full border">
              <div
                className={cn(
                  "h-full transition-[width] duration-75",
                  // Apagada enquanto o gate segura: dá para ver, sem ouvir nada, o
                  // exato momento em que ele abre e fecha.
                  gateSegurando ? "bg-muted-foreground/40" : "bg-gradient-amber",
                )}
                style={{ width: `${Math.round(nivel * 100)}%` }}
              />
              {prefs.noiseGate && !semWorklet && (
                // O limiar, no mesmo eixo do nível: o que não chega até aqui o gate
                // segura. É por isso que a preferência é guardada nesta escala.
                <div
                  className="bg-foreground/60 absolute inset-y-0 w-0.5"
                  style={{ left: `${Math.round(prefs.noiseGateThreshold * 100)}%` }}
                />
              )}
            </div>

            {/* O A/B em imagem: a mesma voz, depois do modelo, na mesma largura e
              na mesma escala da barra de cima. Só aparece com a IA ligada
              porque, desligada, seria a barra de cima repetida. */}
            {testando && prefs.noiseSuppressionIA && estadoIA === "ligado" && (
              <div
                className="border-border bg-surface-2 relative h-4 overflow-hidden rounded-full border"
                title="depois da IA"
              >
                <div
                  className="bg-neon/70 h-full transition-[width] duration-75"
                  style={{ width: `${Math.round(nivelIA * 100)}%` }}
                />
              </div>
            )}
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
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="ia" className="flex items-center gap-2">
            <Sparkles className="size-4" /> Supressão de ruído por IA
          </Label>
          <Switch
            id="ia"
            checked={prefs.noiseSuppressionIA && !semWorklet}
            disabled={semWorklet}
            onCheckedChange={(v) => {
              renovarTeste();
              // Dois cortadores de ruído em série brigam: o do navegador já
              // mexeu no sinal quando o modelo o recebe, e o resultado é voz
              // com buraco. Ligar a IA desliga o do navegador, desligar devolve
              // — que é o padrão de quem nunca mexeu em nada disto.
              setPrefs({ noiseSuppressionIA: v, noiseSuppression: !v });
            }}
          />
        </div>
        <p className="text-muted-foreground -mt-2 text-xs">
          Um modelo pequeno rodando aqui no seu navegador, que separa a sua voz do resto — teclado,
          saco de salgadinho, ventilador — inclusive enquanto você fala. Vem desligada: custa CPU e
          baixa uns 200 KB na primeira vez que você liga.
        </p>

        {semWorklet ? (
          <p className="text-warning flex items-start gap-1.5 text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            Este navegador não tem AudioWorklet, então o modelo não roda aqui.
          </p>
        ) : (
          prefs.noiseSuppressionIA && (
            <>
              {estadoIA === "carregando" && (
                <p className="text-muted-foreground text-xs">Baixando o modelo…</p>
              )}
              {estadoIA === "indisponivel" && (
                <p className="text-warning flex items-start gap-1.5 text-xs">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  Não consegui rodar o modelo neste navegador — pode ser a placa de som numa taxa
                  que ele não aceita, ou o download que falhou. Seu áudio continua indo inteiro para
                  a mesa.
                </p>
              )}
              <p className="text-muted-foreground text-xs">
                Ligue o teste com o retorno e vá ligando e desligando esta chave enquanto faz o seu
                barulho. A troca é na hora, sem cortar o microfone — é assim que dá para comparar.
              </p>
            </>
          )
        )}
      </div>

      <div className="border-border space-y-4 border-t pt-5">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="gate" className="flex items-center gap-2">
            <Waves className="size-4" /> Gate de ruído
          </Label>
          <Switch
            id="gate"
            checked={prefs.noiseGate && !semWorklet}
            disabled={semWorklet}
            onCheckedChange={(v) => {
              renovarTeste();
              setPrefs({ noiseGate: v });
            }}
          />
        </div>
        <p className="text-muted-foreground -mt-2 text-xs">
          Segura o que está abaixo do limiar — respiração, saco de salgadinho, tecladinho — e deixa
          a voz passar. Vem desligado: ligue se a mesa reclamar do seu barulho de fundo.
        </p>

        {semWorklet ? (
          <p className="text-warning flex items-start gap-1.5 text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            Este navegador não tem AudioWorklet, então o gate não roda aqui. Seu áudio continua indo
            inteiro para a mesa.
          </p>
        ) : (
          prefs.noiseGate && (
            <div className="space-y-2">
              <Label htmlFor="sensibilidade">Sensibilidade</Label>
              <Slider
                id="sensibilidade"
                min={0}
                max={Math.round(LIMIAR_MAXIMO * 100)}
                step={1}
                value={[Math.round(prefs.noiseGateThreshold * 100)]}
                onValueChange={([v]) => {
                  renovarTeste();
                  setPrefs({ noiseGateThreshold: (v ?? 6) / 100 });
                }}
              />
              <p className="text-muted-foreground text-xs">
                A linha no medidor lá em cima é este limiar. Ligue o teste com o retorno e arraste
                até a barra passar da linha quando você fala e ficar aquém quando você só respira.
                Mais para a direita corta mais — e come mais voz baixinha.
              </p>
            </div>
          )
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
          prefs.noiseSuppressionIA
            ? "Desligado enquanto a supressão por IA está ligada: os dois em série brigam pelo mesmo sinal."
            : "Segura ventilador, ar-condicionado e chiado constante.",
          undefined,
          prefs.noiseSuppressionIA,
        )}
        {interruptor(
          "eco",
          "Cancelamento de eco",
          prefs.echoCancellation,
          (v) => setPrefs({ echoCancellation: v }),
          "Ligue se você ouve a mesa pela caixa de som: impede que esse som volte pelo seu microfone. Com fone não há eco para cancelar, e ligado ele corta pedaços de palavra à toa.",
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
