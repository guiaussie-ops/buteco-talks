/**
 * Os sons do buteco, sintetizados na hora (sem arquivo de áudio nenhum):
 *
 * - chegada: o "tssss" de garrafa abrindo, quando alguém entra no bar;
 * - mensagem: um "plim" de dois tons, na conversa privada;
 * - atenção: o zumbido trêmulo do "chamar atenção".
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

/** Zumbido grave e trêmulo, do tamanho da sacudida da janela. */
export function tocarAtencao() {
  const c = contexto();
  if (!c || c.state !== "running") return;
  const t = c.currentTime;
  const o = c.createOscillator();
  o.type = "square";
  o.frequency.value = 110;
  const tremolo = c.createOscillator();
  tremolo.frequency.value = 22;
  const profundidade = c.createGain();
  profundidade.gain.value = 40;
  tremolo.connect(profundidade);
  profundidade.connect(o.frequency);
  const filtro = c.createBiquadFilter();
  filtro.type = "lowpass";
  filtro.frequency.value = 900;
  o.connect(filtro);
  filtro.connect(envelope(c, t, 0.02, 0.6, VOLUME * 0.8));
  o.start(t);
  tremolo.start(t);
  o.stop(t + 0.62);
  tremolo.stop(t + 0.62);
}
