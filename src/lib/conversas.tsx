import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { tocarAtencao, tocarMensagem } from "@/lib/sons";

export type MensagemPrivada = {
  id: string;
  de_id: string;
  para_id: string;
  tipo: "texto" | "atencao";
  texto: string;
  created_at: string;
  lida_em: string | null;
};

export const COLUNAS_DA_MENSAGEM_PRIVADA = "id, de_id, para_id, tipo, texto, created_at, lida_em";

/** Uma janela de conversa aberta, como no MSN. */
export type Janela = {
  /** Com quem é a conversa. */
  userId: string;
  minimizada: boolean;
  /** Mensagens que chegaram com a janela minimizada. */
  naoLidas: number;
  /** Muda a cada "chamar atenção" recebido: é o que faz a janela tremer de novo. */
  tremerEm: number;
};

type Ctx = {
  janelas: Janela[];
  abrirConversa: (userId: string) => void;
  minimizar: (userId: string) => void;
  fechar: (userId: string) => void;
  /** Se os sons estão valendo agora (preferência, fone mudo, status ocupado). */
  comSom: boolean;
};

const ConversasContext = createContext<Ctx | null>(null);

export const chaveDaConversa = (outro: string) => ["conversa", outro] as const;

/**
 * As conversas privadas abertas e o que chega pelo Realtime. Mensagem nova de
 * alguém com a janela fechada abre a janela minimizada, com o número de não
 * lidas, e um aviso no canto. "Chamar atenção" abre a janela e faz tremer.
 *
 * Ao entrar, as mensagens que chegaram enquanto você estava fora (as ainda não
 * lidas) já aparecem como janelas minimizadas — as "mensagens offline" do MSN.
 */
export function ConversasProvider({
  meuId,
  nomeDe,
  comSom,
  children,
}: {
  meuId: string;
  comSom: boolean;
  /** Nome de alguém, para o aviso de mensagem nova. */
  nomeDe: (userId: string) => string;
  children: ReactNode;
}) {
  const qc = useQueryClient();
  const [janelas, setJanelas] = useState<Janela[]>([]);
  const janelasRef = useRef(janelas);
  janelasRef.current = janelas;
  const nomeDeRef = useRef(nomeDe);
  nomeDeRef.current = nomeDe;
  const comSomRef = useRef(comSom);
  comSomRef.current = comSom;

  const abrirConversa = useCallback((userId: string) => {
    setJanelas((prev) =>
      prev.some((j) => j.userId === userId)
        ? prev.map((j) => (j.userId === userId ? { ...j, minimizada: false, naoLidas: 0 } : j))
        : [...prev, { userId, minimizada: false, naoLidas: 0, tremerEm: 0 }],
    );
  }, []);
  const minimizar = useCallback((userId: string) => {
    setJanelas((prev) => prev.map((j) => (j.userId === userId ? { ...j, minimizada: true } : j)));
  }, []);
  const fechar = useCallback((userId: string) => {
    setJanelas((prev) => prev.filter((j) => j.userId !== userId));
  }, []);

  // Mensagens que chegaram com o app fechado.
  useEffect(() => {
    let ativo = true;
    void supabase
      .from("mensagens_privadas")
      .select("de_id")
      .eq("para_id", meuId)
      .is("lida_em", null)
      .limit(500)
      .then(({ data }) => {
        if (!ativo || !data?.length) return;
        const porPessoa = new Map<string, number>();
        data.forEach((m) => porPessoa.set(m.de_id, (porPessoa.get(m.de_id) ?? 0) + 1));
        setJanelas((prev) => [
          ...prev,
          ...[...porPessoa]
            .filter(([id]) => !prev.some((j) => j.userId === id))
            .map(([userId, naoLidas]) => ({ userId, minimizada: true, naoLidas, tremerEm: 0 })),
        ]);
      });
    return () => {
      ativo = false;
    };
  }, [meuId]);

  useEffect(() => {
    const anexar = (outro: string, msg: MensagemPrivada) =>
      qc.setQueryData<MensagemPrivada[]>(chaveDaConversa(outro), (prev) =>
        prev && !prev.some((m) => m.id === msg.id) ? [...prev, msg] : prev,
      );

    const canal = supabase
      .channel(`conversas:${meuId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "mensagens_privadas",
          filter: `para_id=eq.${meuId}`,
        },
        (payload) => {
          const msg = payload.new as MensagemPrivada;
          anexar(msg.de_id, msg);
          const atual = janelasRef.current.find((j) => j.userId === msg.de_id);
          const atencao = msg.tipo === "atencao";

          setJanelas((prev) => {
            const j = prev.find((x) => x.userId === msg.de_id);
            if (!j) {
              return [
                ...prev,
                {
                  userId: msg.de_id,
                  minimizada: !atencao,
                  naoLidas: atencao ? 0 : 1,
                  tremerEm: atencao ? Date.now() : 0,
                },
              ];
            }
            return prev.map((x) =>
              x.userId !== msg.de_id
                ? x
                : atencao
                  ? { ...x, minimizada: false, naoLidas: 0, tremerEm: Date.now() }
                  : x.minimizada
                    ? { ...x, naoLidas: x.naoLidas + 1 }
                    : x,
            );
          });

          // Chamar atenção sempre faz barulho; mensagem comum só quando a
          // conversa não está à vista (ou a aba está em segundo plano).
          const aVista = !!atual && !atual.minimizada && document.visibilityState === "visible";
          if (comSomRef.current) {
            if (atencao) tocarAtencao();
            else if (!aVista) tocarMensagem();
          }

          // Aviso só quando a conversa não está à vista.
          if (!atual || atual.minimizada) {
            const nome = nomeDeRef.current(msg.de_id);
            toast(atencao ? `${nome} chamou a sua atenção!` : `${nome} diz:`, {
              description: atencao ? undefined : msg.texto.slice(0, 120),
              action: { label: "Abrir", onClick: () => abrirConversa(msg.de_id) },
            });
          }
        },
      )
      // O que eu mandei de outra aba aparece aqui também.
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "mensagens_privadas",
          filter: `de_id=eq.${meuId}`,
        },
        (payload) => {
          const msg = payload.new as MensagemPrivada;
          anexar(msg.para_id, msg);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(canal);
    };
  }, [meuId, qc, abrirConversa]);

  const value = useMemo(
    () => ({ janelas, abrirConversa, minimizar, fechar, comSom }),
    [janelas, abrirConversa, minimizar, fechar, comSom],
  );
  return <ConversasContext.Provider value={value}>{children}</ConversasContext.Provider>;
}

/** Fora do provider devolve um "sem conversas" que não quebra quem chama. */
export function useConversas(): Ctx {
  return (
    useContext(ConversasContext) ?? {
      janelas: [],
      abrirConversa: () => undefined,
      minimizar: () => undefined,
      fechar: () => undefined,
      comSom: false,
    }
  );
}
