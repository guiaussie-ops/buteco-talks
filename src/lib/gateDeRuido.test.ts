import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PISO_DO_GATE,
  RMS_CHEIO,
  ajustarLimiar,
  carregarWorklet,
  limiarEmRms,
  ponteDeGate,
} from "@/lib/gateDeRuido";

/**
 * Nó de áudio de mentira: só registra com quem está ligado. É o bastante para
 * conferir o desenho do grafo, que é o que a ponte promete.
 */
class NoFalso {
  ligacoes = new Set<NoFalso>();
  connect(destino: NoFalso) {
    this.ligacoes.add(destino);
    return destino;
  }
  disconnect() {
    this.ligacoes.clear();
  }
}

class WorkletFalso extends NoFalso {
  static criados: WorkletFalso[] = [];
  parameters = new Map([
    ["limiar", { value: 0 }],
    ["piso", { value: 0 }],
  ]);
  port: { onmessage: ((e: MessageEvent) => void) | null } = { onmessage: null };
  constructor() {
    super();
    WorkletFalso.criados.push(this);
  }
}

/** Contexto cujo addModule só termina quando o teste manda. */
function contextoFalso({ semWorklet = false, falha = false } = {}) {
  let liberar!: () => void;
  const carregou = new Promise<void>((resolve, reject) => {
    liberar = falha ? () => reject(new Error("404")) : resolve;
  });
  const addModule = vi.fn(() => carregou);
  const ctx = (semWorklet ? {} : { audioWorklet: { addModule } }) as unknown as BaseAudioContext;
  return { ctx, addModule, liberar };
}

/** Deixa as promessas pendentes andarem. */
const esvaziarFila = () => new Promise((r) => setTimeout(r, 0));

const ligados = (no: NoFalso) => [...no.ligacoes];

beforeEach(() => {
  WorkletFalso.criados = [];
  vi.stubGlobal("AudioWorkletNode", WorkletFalso);
});
afterEach(() => vi.unstubAllGlobals());

describe("limiarEmRms", () => {
  it("converte a posição do medidor para RMS de verdade", () => {
    expect(limiarEmRms(0.5)).toBeCloseTo(0.5 * RMS_CHEIO);
  });

  it("prende fora da faixa do medidor", () => {
    expect(limiarEmRms(-1)).toBe(0);
    expect(limiarEmRms(3)).toBe(RMS_CHEIO);
  });
});

describe("carregarWorklet", () => {
  it("falha aberto num navegador sem AudioWorklet", async () => {
    const { ctx } = contextoFalso({ semWorklet: true });
    await expect(carregarWorklet(ctx)).resolves.toBe(false);
  });

  it("falha aberto quando o arquivo não carrega", async () => {
    const { ctx, liberar } = contextoFalso({ falha: true });
    const pedido = carregarWorklet(ctx);
    liberar();
    await expect(pedido).resolves.toBe(false);
  });

  it("pede o módulo uma vez só por contexto (duas é erro no Firefox)", async () => {
    const { ctx, addModule, liberar } = contextoFalso();
    const a = carregarWorklet(ctx);
    const b = carregarWorklet(ctx);
    liberar();
    await expect(a).resolves.toBe(true);
    await expect(b).resolves.toBe(true);
    expect(addModule).toHaveBeenCalledTimes(1);
  });
});

describe("ajustarLimiar", () => {
  it("move o limiar e garante o piso", () => {
    const no = new WorkletFalso();
    ajustarLimiar(no as unknown as AudioWorkletNode, 0.5);
    expect(no.parameters.get("limiar")!.value).toBeCloseTo(0.5 * RMS_CHEIO);
    expect(no.parameters.get("piso")!.value).toBe(PISO_DO_GATE);
  });
});

describe("ponteDeGate", () => {
  function montar(opcoes?: Parameters<typeof contextoFalso>[0]) {
    const falso = contextoFalso(opcoes);
    const entrada = new NoFalso();
    const saida = new NoFalso();
    entrada.connect(saida);
    const estados: boolean[] = [];
    const ponte = ponteDeGate(
      falso.ctx,
      entrada as unknown as AudioNode,
      saida as unknown as AudioNode,
      (aberto) => estados.push(aberto),
    );
    return { ...falso, entrada, saida, ponte, estados };
  }

  it("ligar põe o gate no meio: entrada → gate → saída", async () => {
    const { ponte, entrada, saida, liberar } = montar();
    ponte.sincronizar(true, 0.1);
    liberar();
    await esvaziarFila();
    const [gate] = WorkletFalso.criados;
    expect(ligados(entrada)).toEqual([gate]);
    expect(ligados(gate!)).toEqual([saida]);
  });

  it("enquanto o worklet carrega, a ligação direta continua valendo", () => {
    const { ponte, entrada, saida } = montar();
    ponte.sincronizar(true, 0.1);
    expect(ligados(entrada)).toEqual([saida]);
  });

  it("desligar é síncrono e devolve a ligação direta na hora", async () => {
    const { ponte, entrada, saida, liberar, estados } = montar();
    ponte.sincronizar(true, 0.1);
    liberar();
    await esvaziarFila();
    ponte.sincronizar(false, 0.1);
    // Sem await: é a válvula de escape quando o gate está comendo voz.
    expect(ligados(entrada)).toEqual([saida]);
    expect(ligados(WorkletFalso.criados[0]!)).toEqual([]);
    expect(estados.at(-1)).toBe(true);
  });

  it("descarta o gate que chega depois de a pessoa já ter desligado", async () => {
    const { ponte, entrada, saida, liberar } = montar();
    ponte.sincronizar(true, 0.1);
    ponte.sincronizar(false, 0.1);
    liberar();
    await esvaziarFila();
    expect(ligados(entrada)).toEqual([saida]);
    expect(ligados(WorkletFalso.criados[0]!)).toEqual([]);
  });

  it("descarta o gate que chega depois de a ponte ser destruída", async () => {
    const { ponte, entrada, saida, liberar } = montar();
    ponte.sincronizar(true, 0.1);
    ponte.destruir();
    liberar();
    await esvaziarFila();
    expect(ligados(entrada)).toEqual([saida]);
    // E não aceita mais nada depois de destruída.
    ponte.sincronizar(true, 0.1);
    await esvaziarFila();
    expect(WorkletFalso.criados).toHaveLength(1);
  });

  it("com o gate ligado, mexer no limiar só ajusta, sem criar outro nó", async () => {
    const { ponte, liberar } = montar();
    ponte.sincronizar(true, 0.1);
    liberar();
    await esvaziarFila();
    ponte.sincronizar(true, 0.3);
    expect(WorkletFalso.criados).toHaveLength(1);
    expect(WorkletFalso.criados[0]!.parameters.get("limiar")!.value).toBeCloseTo(0.3 * RMS_CHEIO);
  });

  it("pedir duas vezes enquanto carrega não cria dois gates", async () => {
    const { ponte, liberar } = montar();
    ponte.sincronizar(true, 0.1);
    ponte.sincronizar(true, 0.2);
    liberar();
    await esvaziarFila();
    expect(WorkletFalso.criados).toHaveLength(1);
  });

  it("sem worklet no navegador, segue sem gate em vez de ficar mudo", async () => {
    const { ponte, entrada, saida } = montar({ semWorklet: true });
    ponte.sincronizar(true, 0.1);
    await esvaziarFila();
    expect(ligados(entrada)).toEqual([saida]);
    expect(WorkletFalso.criados).toHaveLength(0);
  });

  it("repassa o aberto/fechado que o worklet anuncia", async () => {
    const { ponte, liberar, estados } = montar();
    ponte.sincronizar(true, 0.1);
    liberar();
    await esvaziarFila();
    const porta = WorkletFalso.criados[0]!.port;
    porta.onmessage!({ data: { aberto: false } } as MessageEvent);
    porta.onmessage!({ data: { aberto: true } } as MessageEvent);
    expect(estados).toEqual([false, true]);
  });
});
