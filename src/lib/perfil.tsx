import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type Ctx = {
  /** De quem é o perfil aberto agora, ou null. */
  aberto: string | null;
  abrirPerfil: (userId: string) => void;
  fecharPerfil: () => void;
};

const PerfilContext = createContext<Ctx | null>(null);

/**
 * Abre o perfil de qualquer pessoa a partir de qualquer canto do app: a
 * tampinha na barra, a cadeira na mesa de voz, o nome no chat, a lista de
 * membros. Um diálogo só, montado uma vez lá em cima.
 */
export function PerfilProvider({ children }: { children: ReactNode }) {
  const [aberto, setAberto] = useState<string | null>(null);
  const abrirPerfil = useCallback((id: string) => setAberto(id), []);
  const fecharPerfil = useCallback(() => setAberto(null), []);
  const value = useMemo(
    () => ({ aberto, abrirPerfil, fecharPerfil }),
    [aberto, abrirPerfil, fecharPerfil],
  );
  return <PerfilContext.Provider value={value}>{children}</PerfilContext.Provider>;
}

/**
 * Fora do provider (uma tela que não tem perfil) devolve funções que não
 * fazem nada, em vez de quebrar: o controle de volume, por exemplo, é usado
 * dos dois jeitos.
 */
export function usePerfil(): Ctx {
  return (
    useContext(PerfilContext) ?? {
      aberto: null,
      abrirPerfil: () => undefined,
      fecharPerfil: () => undefined,
    }
  );
}
