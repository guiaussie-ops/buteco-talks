import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { LIMIAR_MAXIMO, LIMIAR_PADRAO } from "@/lib/gateDeRuido";
import { VOLUME_MAXIMO } from "@/lib/saidaDeAudio";

/**
 * O que você escolheu para UMA pessoa da mesa. Só para você: nada disto sai
 * daqui, nem para a presença nem para a outra ponta.
 *
 * Volume e mudo são campos separados de propósito. Se "mudo" fosse só
 * `volume = 0`, desmutar teria que chutar um valor — e chutaria 100%,
 * jogando fora o 40% que a pessoa tinha ajustado. Separados, desmutar
 * devolve exatamente o que estava antes.
 */
export type AudioDoParticipante = {
  /** 0 a VOLUME_MAXIMO. Acima de 1 amplifica — ver `ganhoEfetivo`. */
  volume: number;
  muted: boolean;
};

export const AUDIO_DO_PARTICIPANTE_PADRAO: AudioDoParticipante = { volume: 1, muted: false };

export type MediaPrefs = {
  /** null = deixa o navegador escolher */
  micId: string | null;
  speakerId: string | null;
  cameraId: string | null;
  /** ganho aplicado ao que sai do seu microfone (1 = sem mexer) */
  inputGain: number;
  /** volume com que você ouve a mesa (0 a 1) */
  outputVolume: number;
  /**
   * Volume e mudo por participante. Chaveado por user_id, então a escolha vale
   * para a pessoa em qualquer mesa e sobrevive a ela sair e voltar.
   */
  peerAudio: Record<string, AudioDoParticipante>;
  /**
   * Filtros que o próprio navegador aplica no pipeline de captura.
   *
   * Ruído e ganho automático vêm ligados, que é o que faz o microfone soar bem
   * sem ninguém configurar nada. O cancelamento de eco vem DESLIGADO: aqui a
   * maioria usa fone, e nesse caso ele não tem eco para cancelar — só corta
   * pedaço de palavra à toa. Quem usa caixa de som liga na mão.
   */
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  /**
   * Gate de ruído nosso, num AudioWorklet: corta o que está abaixo do limiar
   * (respiração, saco de salgadinho, tecladinho) e deixa a voz passar.
   *
   * Nasce DESLIGADO. Ligar reativa o caminho por Web Audio, que já nos custou
   * áudio baixo e eco — desligar volta à faixa crua na hora. Quem liga é quem
   * tem o problema e vai calibrar ouvindo no teste de microfone.
   */
  noiseGate: boolean;
  /**
   * Limiar do gate na MESMA escala do medidor do teste (0 a 1): a posição do
   * slider é a posição da linha na barra.
   */
  noiseGateThreshold: number;
  /**
   * Supressão de ruído por IA (GTCRN, 2024), num AudioWorklet. Ao contrário do
   * gate, que só decide passa/não passa, ela separa voz de ruído dentro do
   * mesmo instante — teclado e saco de salgadinho somem enquanto você fala.
   *
   * Nasce DESLIGADA, pelas duas razões de sempre: reativa o caminho por Web
   * Audio, que já nos custou áudio baixo e eco, e custa CPU de verdade (um
   * modelo rodando na thread de áudio). Quem liga é quem tem o problema e vai
   * conferir no A/B do teste de microfone.
   */
  noiseSuppressionIA: boolean;
  /**
   * Sons do bar: o "tssss" de quem chega, o "plim" de mensagem privada e o
   * zumbido do chamar atenção. Ligados por padrão, como no MSN.
   */
  sons: boolean;
};

export const MEDIA_PREFS_PADRAO: MediaPrefs = {
  micId: null,
  speakerId: null,
  cameraId: null,
  inputGain: 1,
  outputVolume: 1,
  peerAudio: {},
  echoCancellation: false,
  noiseSuppression: true,
  autoGainControl: true,
  noiseGate: false,
  noiseGateThreshold: LIMIAR_PADRAO,
  noiseSuppressionIA: false,
  sons: true,
};

const CHAVE = "buteco:media-prefs";

/** Patch direto ou calculado a partir do estado atual (para mapas como peerVolumes). */
type PrefsPatch = Partial<MediaPrefs> | ((atual: MediaPrefs) => Partial<MediaPrefs>);

type Ctx = {
  prefs: MediaPrefs;
  setPrefs: (patch: PrefsPatch) => void;
};

const MediaPrefsContext = createContext<Ctx | null>(null);

function ler(): MediaPrefs {
  if (typeof window === "undefined") return MEDIA_PREFS_PADRAO;
  try {
    const cru = window.localStorage.getItem(CHAVE);
    if (!cru) return MEDIA_PREFS_PADRAO;
    return normalizarPrefs(JSON.parse(cru));
  } catch {
    // Janela anônima, storage bloqueado, JSON corrompido: segue no padrão.
    return MEDIA_PREFS_PADRAO;
  }
}

/**
 * Transforma o que estava gravado em preferências válidas. Mescla com o
 * padrão, porque uma preferência gravada por uma versão antiga do app pode
 * não ter todos os campos, e prende cada número na faixa dele.
 */
export function normalizarPrefs(cru: unknown): MediaPrefs {
  if (!cru || typeof cru !== "object") return MEDIA_PREFS_PADRAO;
  const salvo = cru as Partial<MediaPrefs>;
  return {
    ...MEDIA_PREFS_PADRAO,
    ...salvo,
    inputGain: clamp(salvo.inputGain ?? 1, 0, 2),
    outputVolume: clamp(salvo.outputVolume ?? 1, 0, 1),
    peerAudio: lerPeerAudio(salvo),
    // `??` e não `!!`: campo ausente (preferência gravada por uma versão
    // antiga) tem que cair no padrão, não virar false na marra.
    echoCancellation: salvo.echoCancellation ?? MEDIA_PREFS_PADRAO.echoCancellation,
    noiseSuppression: salvo.noiseSuppression ?? MEDIA_PREFS_PADRAO.noiseSuppression,
    autoGainControl: salvo.autoGainControl ?? MEDIA_PREFS_PADRAO.autoGainControl,
    noiseGate: salvo.noiseGate ?? MEDIA_PREFS_PADRAO.noiseGate,
    noiseGateThreshold: clamp(salvo.noiseGateThreshold ?? LIMIAR_PADRAO, 0, LIMIAR_MAXIMO),
    noiseSuppressionIA: salvo.noiseSuppressionIA ?? MEDIA_PREFS_PADRAO.noiseSuppressionIA,
    sons: salvo.sons ?? MEDIA_PREFS_PADRAO.sons,
  };
}

/**
 * Descarta entradas corrompidas em vez de deixar um NaN silenciar alguém, e
 * converte o formato antigo.
 *
 * Até a versão passada isto era `peerVolumes: Record<string, number>` de 0 a 1,
 * e mudo alguém era arrastar o slider até 0 — a interface inteira testava
 * `percent === 0`. Na conversão, esse 0 vira `muted: true` com o volume de
 * volta em 100%: era exatamente essa a intenção de quem arrastou, e agora
 * desmutar tem para onde voltar.
 */
function lerPeerAudio(salvo: Partial<MediaPrefs> & { peerVolumes?: unknown }) {
  const saida: Record<string, AudioDoParticipante> = {};

  const antigo = salvo.peerVolumes;
  if (antigo && typeof antigo === "object") {
    for (const [id, v] of Object.entries(antigo as Record<string, unknown>)) {
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      saida[id] =
        v === 0 ? { volume: 1, muted: true } : { volume: clamp(v, 0, VOLUME_MAXIMO), muted: false };
    }
  }

  const novo = salvo.peerAudio;
  if (novo && typeof novo === "object") {
    for (const [id, v] of Object.entries(novo as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const { volume, muted } = v as Partial<AudioDoParticipante>;
      if (typeof volume !== "number" || !Number.isFinite(volume)) continue;
      saida[id] = { volume: clamp(volume, 0, VOLUME_MAXIMO), muted: muted === true };
    }
  }

  return saida;
}

function clamp(v: number, min: number, max: number) {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

export function MediaPrefsProvider({ children }: { children: ReactNode }) {
  // O SSR não tem localStorage; começar no padrão e ler depois evita divergência
  // entre o HTML do servidor e a primeira renderização no cliente.
  const [prefs, setPrefsState] = useState<MediaPrefs>(MEDIA_PREFS_PADRAO);

  useEffect(() => {
    setPrefsState(ler());
  }, []);

  const setPrefs = useCallback((patch: PrefsPatch) => {
    setPrefsState((atual) => {
      const proximo = { ...atual, ...(typeof patch === "function" ? patch(atual) : patch) };
      try {
        window.localStorage.setItem(CHAVE, JSON.stringify(proximo));
      } catch {
        // Sem storage a escolha ainda vale nesta sessão; só não sobrevive ao reload.
      }
      return proximo;
    });
  }, []);

  const value = useMemo(() => ({ prefs, setPrefs }), [prefs, setPrefs]);

  return <MediaPrefsContext.Provider value={value}>{children}</MediaPrefsContext.Provider>;
}

export function useMediaPrefs() {
  const ctx = useContext(MediaPrefsContext);
  if (!ctx) throw new Error("useMediaPrefs precisa estar dentro de MediaPrefsProvider");
  return ctx;
}

/** Constraint de áudio da captura, já com o dispositivo escolhido. */
export function audioConstraints(prefs: MediaPrefs): MediaTrackConstraints {
  // Estes três são o processamento que o navegador faz no próprio pipeline de
  // captura — o mesmo que o Discord usa. O ganho automático é o que levanta voz
  // fraca; sem ele o microfone chega baixo na mesa. Ficam ligados por padrão e
  // só saem se a pessoa desligar na mão, sabendo o que perde.
  const base: MediaTrackConstraints = {
    echoCancellation: prefs.echoCancellation,
    noiseSuppression: prefs.noiseSuppression,
    autoGainControl: prefs.autoGainControl,
    // Voz é mono. Pedir um canal evita upmix e corta banda pela metade.
    channelCount: 1,
  };
  // "ideal" e não "exact": se o fone escolhido não estiver mais plugado, o
  // navegador cai no padrão em vez de derrubar a entrada na mesa inteira.
  if (prefs.micId) base.deviceId = { ideal: prefs.micId };
  return base;
}

/** Constraint de vídeo da câmera, já com o dispositivo escolhido. */
export function videoConstraints(prefs: MediaPrefs): MediaTrackConstraints {
  const base: MediaTrackConstraints = { width: 1280, height: 720 };
  if (prefs.cameraId) base.deviceId = { ideal: prefs.cameraId };
  return base;
}

/** Só os três filtros, para aplicar ao vivo numa faixa já aberta. */
export function filtrosDeAudio(prefs: MediaPrefs) {
  return {
    echoCancellation: prefs.echoCancellation,
    noiseSuppression: prefs.noiseSuppression,
    autoGainControl: prefs.autoGainControl,
  };
}
