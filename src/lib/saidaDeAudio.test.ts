import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarSaidaDeAudio, ganhoEfetivo } from "@/lib/saidaDeAudio";

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

/**
 * AudioParam que guarda as chamadas. O setTargetAtTime "chega" no valor na
 * hora, para o teste poder ler o ganho atual como o contexto leria.
 */
class ParamFalso {
  value: number;
  alvos: number[] = [];
  constructor(inicial: number) {
    this.value = inicial;
  }
  cancelScheduledValues = vi.fn();
  setValueAtTime = vi.fn();
  setTargetAtTime(valor: number) {
    this.alvos.push(valor);
    this.value = valor;
  }
}

class GanhoFalso extends NoFalso {
  gain = new ParamFalso(1);
}

class FonteFalsa extends NoFalso {
  constructor(public stream: unknown) {
    super();
  }
}

class ContextoFalso {
  static ultimo: ContextoFalso;
  state: AudioContextState = "suspended";
  currentTime = 0;
  destination = new NoFalso();
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => undefined);
  setSinkId = vi.fn(async (_id: string) => undefined);
  ganhos: GanhoFalso[] = [];
  constructor() {
    ContextoFalso.ultimo = this;
  }
  createGain() {
    const g = new GanhoFalso();
    this.ganhos.push(g);
    return g;
  }
  createMediaStreamSource(stream: unknown) {
    return new FonteFalsa(stream);
  }
}

type ElementoFalso = {
  autoplay: boolean;
  muted: boolean;
  srcObject: unknown;
  setAttribute: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
};

let elementos: ElementoFalso[];

beforeEach(() => {
  elementos = [];
  vi.stubGlobal("window", { AudioContext: ContextoFalso });
  vi.stubGlobal("document", {
    createElement: () => {
      const el: ElementoFalso = {
        autoplay: false,
        muted: false,
        srcObject: null,
        setAttribute: vi.fn(),
        play: vi.fn(() => Promise.reject(new Error("sem gesto ainda"))),
        remove: vi.fn(),
      };
      elementos.push(el);
      return el;
    },
    body: { appendChild: vi.fn() },
  });
});
afterEach(() => vi.unstubAllGlobals());

const stream = (nome: string) => ({ nome }) as unknown as MediaStream;

/** O ganho do peer é o segundo createGain: o primeiro é o mestre. */
const ganhoDoPeer = (indice = 0) => ContextoFalso.ultimo.ganhos[indice + 1]!;
const mestre = () => ContextoFalso.ultimo.ganhos[0]!;

describe("ganhoEfetivo", () => {
  it("mudo vence o volume sem apagá-lo", () => {
    expect(ganhoEfetivo(0.4, true)).toBe(0);
    expect(ganhoEfetivo(0.4, false)).toBe(0.4);
  });
});

describe("criarSaidaDeAudio", () => {
  it("devolve null sem Web Audio, para quem chama saber que não há volume", () => {
    vi.stubGlobal("window", {});
    expect(criarSaidaDeAudio()).toBeNull();
  });

  it("monta stream → ganho do peer → mestre → destination", () => {
    const saida = criarSaidaDeAudio()!;
    saida.conectar("ana", stream("ana"));
    expect([...mestre().ligacoes]).toEqual([ContextoFalso.ultimo.destination]);
    expect([...ganhoDoPeer().ligacoes]).toEqual([mestre()]);
  });

  it("anexa a faixa a um <audio> mudo, só para o Chrome deixá-la fluir", () => {
    const saida = criarSaidaDeAudio()!;
    const s = stream("ana");
    saida.conectar("ana", s);
    const [el] = elementos;
    expect(el!.muted).toBe(true);
    expect(el!.srcObject).toBe(s);
    expect(el!.setAttribute).toHaveBeenCalledWith("playsinline", "");
  });

  it("aguenta o play() recusado antes do primeiro gesto", async () => {
    const saida = criarSaidaDeAudio()!;
    expect(() => saida.conectar("ana", stream("ana"))).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });

  it("retoma o contexto suspenso ao conectar alguém", () => {
    const saida = criarSaidaDeAudio()!;
    saida.conectar("ana", stream("ana"));
    expect(ContextoFalso.ultimo.resume).toHaveBeenCalled();
  });

  it("conectar de novo com o mesmo stream não refaz nada", () => {
    const saida = criarSaidaDeAudio()!;
    const s = stream("ana");
    saida.conectar("ana", s);
    saida.conectar("ana", s);
    expect(elementos).toHaveLength(1);
  });

  it("stream novo (reconexão) refaz o ramo preservando o volume escolhido", () => {
    const saida = criarSaidaDeAudio()!;
    saida.conectar("ana", stream("ana-1"));
    saida.definirGanhoDoPeer("ana", 0.4);
    saida.conectar("ana", stream("ana-2"));

    expect(elementos).toHaveLength(2);
    // O ramo velho foi solto...
    expect(elementos[0]!.srcObject).toBeNull();
    expect(elementos[0]!.remove).toHaveBeenCalled();
    // ...e o novo nasceu com os 40%, não com 100%.
    expect(ganhoDoPeer(1).gain.value).toBe(0.4);
  });

  it("muda volume por rampa, nunca por degrau (degrau estala no fone)", () => {
    const saida = criarSaidaDeAudio()!;
    saida.conectar("ana", stream("ana"));
    saida.definirGanhoDoPeer("ana", 0.5);
    saida.definirGanhoMestre(0);
    const peer = ganhoDoPeer().gain;
    expect(peer.cancelScheduledValues).toHaveBeenCalled();
    expect(peer.setValueAtTime).toHaveBeenCalled();
    expect(peer.alvos).toEqual([0.5]);
    expect(mestre().gain.alvos).toEqual([0]);
  });

  it("volume de quem não está conectado é ignorado sem erro", () => {
    const saida = criarSaidaDeAudio()!;
    expect(() => saida.definirGanhoDoPeer("fantasma", 0.3)).not.toThrow();
  });

  it("desconectar solta o stream e tira o elemento da página", () => {
    const saida = criarSaidaDeAudio()!;
    saida.conectar("ana", stream("ana"));
    saida.desconectar("ana");
    expect(elementos[0]!.srcObject).toBeNull();
    expect(elementos[0]!.remove).toHaveBeenCalled();
    expect([...ganhoDoPeer().ligacoes]).toEqual([]);
  });

  it("troca o fone pelo setSinkId do contexto, e ignora quando não há escolha", () => {
    const saida = criarSaidaDeAudio()!;
    saida.definirDispositivo(null);
    expect(ContextoFalso.ultimo.setSinkId).not.toHaveBeenCalled();
    saida.definirDispositivo("fone-usb");
    expect(ContextoFalso.ultimo.setSinkId).toHaveBeenCalledWith("fone-usb");
  });

  it("destruir solta todo mundo, fecha o contexto e não aceita mais ninguém", () => {
    const saida = criarSaidaDeAudio()!;
    saida.conectar("ana", stream("ana"));
    saida.conectar("beto", stream("beto"));
    saida.destruir();
    expect(elementos.every((el) => el.srcObject === null)).toBe(true);
    expect(ContextoFalso.ultimo.close).toHaveBeenCalled();
    saida.conectar("carla", stream("carla"));
    expect(elementos).toHaveLength(2);
  });
});
