/**
 * Os sons do buteco, sintetizados na hora (sem arquivo de áudio nenhum):
 *
 * - chegada: o "tssss" de garrafa abrindo, quando alguém entra no bar;
 * - mensagem: um "plim" de dois tons, na conversa privada;
 * - atenção: o chacoalho e o sininho do "chamar atenção".
 *
 * Contexto de áudio próprio e separado do da mesa de voz de propósito: estes
 * são sons de interface, curtos, e não passam perto do microfone nem do grafo
 * de saída das vozes. O navegador só deixa tocar som depois de um gesto da
 * pessoa, então o contexto nasce no primeiro clique ou tecla.
 */

let ctx: AudioContext | null = null;

function contexto(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return ctx;
}

/** Destrava o áudio no primeiro gesto. Chamar uma vez, ao montar o app. */
export function prepararSons() {
  if (typeof window === "undefined") return () => undefined;
  const destravar = () => {
    contexto();
    window.removeEventListener("pointerdown", destravar);
    window.removeEventListener("keydown", destravar);
  };
  window.addEventListener("pointerdown", destravar);
  window.addEventListener("keydown", destravar);
  return () => {
    window.removeEventListener("pointerdown", destravar);
    window.removeEventListener("keydown", destravar);
  };
}

/** Volume geral dos sons de interface: discretos, abaixo da voz da mesa. */
const VOLUME = 0.18;

function envelope(c: AudioContext, inicio: number, ataque: number, duracao: number, pico = VOLUME) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, inicio);
  g.gain.exponentialRampToValueAtTime(pico, inicio + ataque);
  g.gain.exponentialRampToValueAtTime(0.0001, inicio + duracao);
  g.connect(c.destination);
  return g;
}

/** "Pop" da tampinha saindo e o "tssss" do gás: ruído filtrado que some. */
export function tocarChegada() {
  const c = contexto();
  if (!c || c.state !== "running") return;
  const t = c.currentTime;

  const pop = c.createOscillator();
  pop.type = "sine";
  pop.frequency.setValueAtTime(420, t);
  pop.frequency.exponentialRampToValueAtTime(120, t + 0.06);
  pop.connect(envelope(c, t, 0.004, 0.08, VOLUME * 1.4));
  pop.start(t);
  pop.stop(t + 0.1);

  const duracao = 0.55;
  const amostras = Math.floor(c.sampleRate * duracao);
  const buffer = c.createBuffer(1, amostras, c.sampleRate);
  const dados = buffer.getChannelData(0);
  for (let i = 0; i < amostras; i++) dados[i] = Math.random() * 2 - 1;
  const ruido = c.createBufferSource();
  ruido.buffer = buffer;
  const filtro = c.createBiquadFilter();
  filtro.type = "bandpass";
  filtro.frequency.setValueAtTime(5200, t + 0.04);
  filtro.frequency.exponentialRampToValueAtTime(2600, t + 0.04 + duracao);
  filtro.Q.value = 0.9;
  ruido.connect(filtro);
  filtro.connect(envelope(c, t + 0.04, 0.02, duracao, VOLUME * 0.9));
  ruido.start(t + 0.04);
  ruido.stop(t + 0.04 + duracao);
}

/** "Plim": duas notas curtas subindo. */
export function tocarMensagem() {
  const c = contexto();
  if (!c || c.state !== "running") return;
  const t = c.currentTime;
  [
    [880, 0],
    [1320, 0.11],
  ].forEach(([freq, atraso]) => {
    const o = c.createOscillator();
    o.type = "triangle";
    o.frequency.value = freq!;
    o.connect(envelope(c, t + atraso!, 0.01, 0.28));
    o.start(t + atraso!);
    o.stop(t + atraso! + 0.3);
  });
}

/**
 * Chamar atenção: a janela chacoalhando e depois um sininho.
 *
 * O primeiro era uma onda quadrada grave tremendo, e no teste soou como
 * defeito de caixa de som, não como alguém cutucando. Agora são duas partes:
 * oito batidas secas e rápidas — madeira, não buzina —, no ritmo da sacudida
 * da janela, e por cima três notas subindo, claras, que é o que faz a pessoa
 * olhar para a tela mesmo de longe.
 */
export function tocarAtencao() {
  const c = contexto();
  if (!c || c.state !== "running") return;
  const t = c.currentTime;

  // Chacoalho: cada batida é um estalo de ruído curto com um "toc" grave.
  const batidas = 8;
  const passo = 0.055;
  const amostras = Math.floor(c.sampleRate * 0.03);
  const buffer = c.createBuffer(1, amostras, c.sampleRate);
  const dados = buffer.getChannelData(0);
  for (let i = 0; i < amostras; i++) dados[i] = (Math.random() * 2 - 1) * (1 - i / amostras);
  for (let i = 0; i < batidas; i++) {
    const inicio = t + i * passo;
    // Alterna esquerda/direita no tom, como a janela indo e voltando.
    const grave = i % 2 === 0 ? 190 : 150;
    const toc = c.createOscillator();
    toc.type = "sine";
    toc.frequency.setValueAtTime(grave * 1.6, inicio);
    toc.frequency.exponentialRampToValueAtTime(grave, inicio + 0.03);
    toc.connect(envelope(c, inicio, 0.002, 0.05, VOLUME * 1.1));
    toc.start(inicio);
    toc.stop(inicio + 0.06);

    const estalo = c.createBufferSource();
    estalo.buffer = buffer;
    const filtro = c.createBiquadFilter();
    filtro.type = "bandpass";
    filtro.frequency.value = i % 2 === 0 ? 1800 : 1400;
    filtro.Q.value = 1.2;
    estalo.connect(filtro);
    filtro.connect(envelope(c, inicio, 0.001, 0.035, VOLUME * 0.7));
    estalo.start(inicio);
    estalo.stop(inicio + 0.04);
  }

  // Sininho: três notas subindo (mi, sol#, si), cada uma com um harmônico leve.
  const depois = t + batidas * passo + 0.04;
  [
    [1318.5, 0],
    [1661.2, 0.09],
    [1975.5, 0.18],
  ].forEach(([freq, atraso]) => {
    const inicio = depois + atraso!;
    const dur = atraso === 0.18 ? 0.5 : 0.22;
    const nota = c.createOscillator();
    nota.type = "triangle";
    nota.frequency.value = freq!;
    nota.connect(envelope(c, inicio, 0.006, dur, VOLUME * 1.1));
    nota.start(inicio);
    nota.stop(inicio + dur + 0.02);
    const brilho = c.createOscillator();
    brilho.type = "sine";
    brilho.frequency.value = freq! * 2;
    brilho.connect(envelope(c, inicio, 0.004, dur * 0.6, VOLUME * 0.25));
    brilho.start(inicio);
    brilho.stop(inicio + dur);
  });
}
