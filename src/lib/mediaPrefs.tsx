import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type MediaPrefs = {
  /** null = deixa o navegador escolher */
  micId: string | null;
  speakerId: string | null;
  cameraId: string | null;
  /** ganho aplicado ao que sai do seu microfone (1 = sem mexer) */
  inputGain: number;
  /** volume com que você ouve a mesa (0 a 1) */
  outputVolume: number;
};

export const MEDIA_PREFS_PADRAO: MediaPrefs = {
  micId: null,
  speakerId: null,
  cameraId: null,
  inputGain: 1,
  outputVolume: 1,
};

const CHAVE = "buteco:media-prefs";

type Ctx = {
  prefs: MediaPrefs;
  setPrefs: (patch: Partial<MediaPrefs>) => void;
};

const MediaPrefsContext = createContext<Ctx | null>(null);

function ler(): MediaPrefs {
  if (typeof window === "undefined") return MEDIA_PREFS_PADRAO;
  try {
    const cru = window.localStorage.getItem(CHAVE);
    if (!cru) return MEDIA_PREFS_PADRAO;
    const salvo = JSON.parse(cru) as Partial<MediaPrefs>;
    // Mescla com o padrão: uma preferência gravada por uma versão antiga do app
    // pode não ter todos os campos.
    return {
      ...MEDIA_PREFS_PADRAO,
      ...salvo,
      inputGain: clamp(salvo.inputGain ?? 1, 0, 2),
      outputVolume: clamp(salvo.outputVolume ?? 1, 0, 1),
    };
  } catch {
    // Janela anônima, storage bloqueado, JSON corrompido: segue no padrão.
    return MEDIA_PREFS_PADRAO;
  }
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

  const setPrefs = useCallback((patch: Partial<MediaPrefs>) => {
    setPrefsState((atual) => {
      const proximo = { ...atual, ...patch };
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
  // fraca; sem ele o microfone chega baixo na mesa.
  const base: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
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
