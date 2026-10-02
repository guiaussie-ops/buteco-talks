import { describe, expect, it } from "vitest";
import {
  MEDIA_PREFS_PADRAO,
  audioConstraints,
  filtrosDeAudio,
  normalizarPrefs,
  videoConstraints,
} from "@/lib/mediaPrefs";
import { LIMIAR_MAXIMO, LIMIAR_PADRAO } from "@/lib/gateDeRuido";
import { VOLUME_MAXIMO } from "@/lib/saidaDeAudio";

describe("normalizarPrefs", () => {
  it("cai no padrão quando não há nada utilizável", () => {
    expect(normalizarPrefs(null)).toEqual(MEDIA_PREFS_PADRAO);
    expect(normalizarPrefs("lixo")).toEqual(MEDIA_PREFS_PADRAO);
    expect(normalizarPrefs({})).toEqual(MEDIA_PREFS_PADRAO);
  });

  it("completa com o padrão o que uma versão antiga não gravou", () => {
    // Gravado antes de existirem os filtros e o gate.
    const prefs = normalizarPrefs({ micId: "fone", inputGain: 1.4 });
    expect(prefs.micId).toBe("fone");
    expect(prefs.inputGain).toBe(1.4);
    expect(prefs.noiseSuppression).toBe(true);
    expect(prefs.autoGainControl).toBe(true);
    expect(prefs.echoCancellation).toBe(false);
    expect(prefs.noiseGate).toBe(false);
    expect(prefs.noiseGateThreshold).toBe(LIMIAR_PADRAO);
    expect(prefs.noiseSuppressionIA).toBe(false);
  });

  it("sons do bar: ligados por padrão, desligados quando a pessoa desligou", () => {
    expect(normalizarPrefs({}).sons).toBe(true);
    expect(normalizarPrefs({ sons: false }).sons).toBe(false);
  });

  it("respeita um filtro desligado de propósito (false não vira padrão)", () => {
    const prefs = normalizarPrefs({ noiseSuppression: false, autoGainControl: false });
    expect(prefs.noiseSuppression).toBe(false);
    expect(prefs.autoGainControl).toBe(false);
  });

  it("prende ganho, volume e limiar nas faixas deles", () => {
    const prefs = normalizarPrefs({
      inputGain: 9,
      outputVolume: -3,
      noiseGateThreshold: 0.9,
    });
    expect(prefs.inputGain).toBe(2);
    expect(prefs.outputVolume).toBe(0);
    expect(prefs.noiseGateThreshold).toBe(LIMIAR_MAXIMO);
  });

  it("troca número corrompido pelo mínimo da faixa em vez de propagar NaN", () => {
    // JSON não grava NaN, mas grava null, e um campo pode vir como Infinity
    // depois de uma conta errada em memória.
    const prefs = normalizarPrefs({ inputGain: Number.POSITIVE_INFINITY });
    expect(prefs.inputGain).toBe(0);
  });

  describe("volume por pessoa", () => {
    it("lê o formato atual e prende o volume no teto", () => {
      const prefs = normalizarPrefs({
        peerAudio: { ana: { volume: 0.4, muted: true }, beto: { volume: 7, muted: false } },
      });
      expect(prefs.peerAudio["ana"]).toEqual({ volume: 0.4, muted: true });
      expect(prefs.peerAudio["beto"]).toEqual({ volume: VOLUME_MAXIMO, muted: false });
    });

    it("descarta entradas corrompidas em vez de silenciar alguém", () => {
      const prefs = normalizarPrefs({
        peerAudio: {
          semVolume: { muted: true },
          texto: { volume: "alto" },
          nulo: null,
          ok: { volume: 1 },
        },
      });
      expect(Object.keys(prefs.peerAudio)).toEqual(["ok"]);
      // muted ausente não é mudo.
      expect(prefs.peerAudio["ok"]).toEqual({ volume: 1, muted: false });
    });

    it("converte o formato antigo: volume 0 vira mudo com o volume de volta em 100%", () => {
      const prefs = normalizarPrefs({ peerVolumes: { ana: 0, beto: 0.5, lixo: "x" } });
      expect(prefs.peerAudio["ana"]).toEqual({ volume: 1, muted: true });
      expect(prefs.peerAudio["beto"]).toEqual({ volume: 0.5, muted: false });
      expect(prefs.peerAudio["lixo"]).toBeUndefined();
    });

    it("o formato novo vence o antigo para a mesma pessoa", () => {
      const prefs = normalizarPrefs({
        peerVolumes: { ana: 0 },
        peerAudio: { ana: { volume: 0.7, muted: false } },
      });
      expect(prefs.peerAudio["ana"]).toEqual({ volume: 0.7, muted: false });
    });
  });
});

describe("constraints de captura", () => {
  it("pede o microfone escolhido como ideal, não exact", () => {
    const c = audioConstraints({ ...MEDIA_PREFS_PADRAO, micId: "fone" });
    // Com exact, um fone desplugado derrubaria a entrada na mesa inteira.
    expect(c.deviceId).toEqual({ ideal: "fone" });
    expect(c.channelCount).toBe(1);
  });

  it("sem microfone escolhido, deixa o navegador decidir", () => {
    expect(audioConstraints(MEDIA_PREFS_PADRAO).deviceId).toBeUndefined();
  });

  it("leva os três filtros do navegador do jeito que estão nas preferências", () => {
    const prefs = { ...MEDIA_PREFS_PADRAO, echoCancellation: true, autoGainControl: false };
    expect(filtrosDeAudio(prefs)).toEqual({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
    });
    expect(audioConstraints(prefs)).toMatchObject(filtrosDeAudio(prefs));
  });

  it("pede 720p e a câmera escolhida como ideal", () => {
    expect(videoConstraints(MEDIA_PREFS_PADRAO)).toEqual({ width: 1280, height: 720 });
    expect(videoConstraints({ ...MEDIA_PREFS_PADRAO, cameraId: "cam" }).deviceId).toEqual({
      ideal: "cam",
    });
  });
});
