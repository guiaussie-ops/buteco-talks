import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Minus, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  COLUNAS_DA_MENSAGEM_PRIVADA,
  chaveDaConversa,
  useConversas,
  type Janela,
  type MensagemPrivada,
} from "@/lib/conversas";
import { tocarAtencao } from "@/lib/sons";
import { usePerfil } from "@/lib/perfil";
import { STATUS, statusDe } from "@/lib/status";
import { cn } from "@/lib/utils";
import { Bottlecap } from "@/components/Bottlecap";

const LARGURA = 340;
const ALTURA = 440;
/** Intervalo mínimo entre dois "chamar atenção": o MSN também não deixava metralhar. */
const ESPERA_DA_ATENCAO_MS = 10_000;

function usePessoa(userId: string) {
  return useQuery({
    queryKey: ["pessoa-msn", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name, username, avatar_url, status, subnick")
        .eq("id", userId)
        .maybeSingle();
      return data;
    },
    staleTime: 60_000,
  });
}

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Uma janela de conversa privada, à moda do MSN: barra de título âmbar que dá
 * para arrastar, "Fulano diz:", o botão de chamar atenção e a caixa de texto
 * embaixo. Flutua por cima de tudo, em qualquer tela do app.
 */
function JanelaDeConversa({
  janela,
  meuId,
  meuNome,
  indice,
}: {
  janela: Janela;
  meuId: string;
  meuNome: string;
  indice: number;
}) {
  const { minimizar, fechar, comSom } = useConversas();
  const { abrirPerfil } = usePerfil();
  const qc = useQueryClient();
  const outro = janela.userId;
  const pessoa = usePessoa(outro);
  const nome = pessoa.data?.display_name || pessoa.data?.username || "Alguém";
  const status = statusDe(pessoa.data?.status);

  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [tremendo, setTremendo] = useState(false);
  const ultimaAtencaoRef = useRef(0);
  const listaRef = useRef<HTMLDivElement | null>(null);

  // Posição: nasce empilhada no canto de baixo à direita e vai para onde for arrastada.
  const [pos, setPos] = useState(() => ({
    x: Math.max(8, window.innerWidth - LARGURA - 24 - indice * 28),
    y: Math.max(8, window.innerHeight - ALTURA - 24 - indice * 28),
  }));
  const arrasteRef = useRef<{ dx: number; dy: number } | null>(null);

  const conversa = useQuery({
    queryKey: chaveDaConversa(outro),
    queryFn: async (): Promise<MensagemPrivada[]> => {
      const { data, error } = await supabase
        .from("mensagens_privadas")
        .select(COLUNAS_DA_MENSAGEM_PRIVADA)
        .or(`and(de_id.eq.${meuId},para_id.eq.${outro}),and(de_id.eq.${outro},para_id.eq.${meuId})`)
        .order("created_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return ((data ?? []) as MensagemPrivada[]).reverse();
    },
  });
  const mensagens = conversa.data ?? [];

  // Tremer quando chega um "chamar atenção".
  useEffect(() => {
    if (!janela.tremerEm) return;
    setTremendo(true);
    const t = window.setTimeout(() => setTremendo(false), 650);
    return () => window.clearTimeout(t);
  }, [janela.tremerEm]);

  // Com a janela à vista, o que chegou está lido.
  const naoLidasDele = mensagens.filter((m) => m.de_id === outro && !m.lida_em).length;
  useEffect(() => {
    if (janela.minimizada || naoLidasDele === 0) return;
    if (document.visibilityState !== "visible") return;
    void supabase
      .from("mensagens_privadas")
      .update({ lida_em: new Date().toISOString() })
      .eq("para_id", meuId)
      .eq("de_id", outro)
      .is("lida_em", null)
      .then(() => {
        const agora = new Date().toISOString();
        qc.setQueryData<MensagemPrivada[]>(chaveDaConversa(outro), (prev) =>
          prev?.map((m) => (m.de_id === outro && !m.lida_em ? { ...m, lida_em: agora } : m)),
        );
      });
  }, [janela.minimizada, naoLidasDele, meuId, outro, qc]);

  useLayoutEffect(() => {
    const el = listaRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mensagens.length, janela.minimizada]);

  const mandar = async (tipo: "texto" | "atencao") => {
    const conteudo = texto.trim();
    if (tipo === "texto" && !conteudo) return;
    if (tipo === "atencao") {
      const agora = Date.now();
      if (agora - ultimaAtencaoRef.current < ESPERA_DA_ATENCAO_MS) {
        toast.info("Calma! Espera um pouquinho pra chamar a atenção de novo.");
        return;
      }
      ultimaAtencaoRef.current = agora;
      // Quem chama também vê a janela sacudir (e ouve), como no MSN.
      setTremendo(true);
      if (comSom) tocarAtencao();
      window.setTimeout(() => setTremendo(false), 650);
    }
    setEnviando(true);
    const { data, error } = await supabase
      .from("mensagens_privadas")
      .insert({ de_id: meuId, para_id: outro, tipo, texto: tipo === "texto" ? conteudo : "" })
      .select(COLUNAS_DA_MENSAGEM_PRIVADA)
      .single();
    setEnviando(false);
    if (error) {
      toast.error("A mensagem não foi. Tenta de novo.");
      return;
    }
    if (tipo === "texto") setTexto("");
    qc.setQueryData<MensagemPrivada[]>(chaveDaConversa(outro), (prev) =>
      prev && !prev.some((m) => m.id === data.id) ? [...prev, data as MensagemPrivada] : prev,
    );
  };

  if (janela.minimizada) return null;

  return (
    <section
      role="dialog"
      aria-label={`Conversa com ${nome}`}
      className={cn(
        "fixed z-50 flex flex-col overflow-hidden rounded-t-[9px] rounded-b-md border border-[#8a5f1a] bg-[#fbf6ea] text-[#2b2016] shadow-[0_22px_50px_rgb(0_0_0/0.6)]",
        tremendo && "animate-tremer",
      )}
      style={{
        left: pos.x,
        top: pos.y,
        width: LARGURA,
        height: ALTURA,
        fontFamily: "Tahoma, Verdana, sans-serif",
      }}
    >
      {/* barra de título: arrasta a janela */}
      <div
        className="flex h-8 shrink-0 cursor-move items-center gap-2 border-b border-[#a8752a] bg-gradient-to-b from-[#f6d58f] to-[#dfa23a] px-2 select-none"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          arrasteRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const a = arrasteRef.current;
          if (!a) return;
          setPos({
            x: Math.min(Math.max(0, e.clientX - a.dx), window.innerWidth - 80),
            y: Math.min(Math.max(0, e.clientY - a.dy), window.innerHeight - 40),
          });
        }}
        onPointerUp={() => {
          arrasteRef.current = null;
        }}
      >
        <span className={cn("size-3 shrink-0 rounded-full", STATUS[status].cor)} />
        <span className="min-w-0 flex-1 truncate text-xs font-bold text-[#3b2508]">
          {nome} — Conversa
        </span>
        <button
          type="button"
          onClick={() => minimizar(outro)}
          aria-label="Minimizar"
          className="flex h-5 w-6 items-center justify-center rounded-[3px] border border-[#a8752a] bg-[#fbe6b8] text-[#3b2508]"
        >
          <Minus className="size-3" />
        </button>
        <button
          type="button"
          onClick={() => fechar(outro)}
          aria-label="Fechar conversa"
          className="flex h-5 w-6 items-center justify-center rounded-[3px] border border-[#8f2f20] bg-[#d9573f] text-white"
        >
          <X className="size-3" />
        </button>
      </div>

      {/* quem é */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[#ecdcb8] bg-[#fffaf0] px-2.5 py-2 text-xs">
        <Bottlecap name={nome} src={pessoa.data?.avatar_url} className="size-9" />
        <div className="min-w-0 flex-1">
          <p className="truncate">
            <b>{nome}</b> <span className="text-[#8a7553]">({STATUS[status].rotulo})</span>
          </p>
          {pessoa.data?.subnick && (
            <p className="truncate text-[11px] text-[#7a6a52] italic">{pessoa.data.subnick}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => abrirPerfil(outro)}
          aria-label={`Ver o perfil de ${nome}`}
          title="Ver perfil"
          className="flex h-8 w-8 items-center justify-center rounded border border-transparent text-[#8a4b12] hover:border-[#e3b25a] hover:bg-[#fdecc4]"
        >
          <UserRound className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => void mandar("atencao")}
          disabled={enviando}
          aria-label={`Chamar a atenção de ${nome}`}
          title="Chamar atenção"
          className="flex h-8 w-8 items-center justify-center rounded border border-[#e3b25a] bg-[#fdecc4] text-[#c2463a] hover:bg-[#fbe0a6] disabled:opacity-50"
        >
          <BellRing className="size-4" />
        </button>
      </div>

      {/* a conversa */}
      <div
        ref={listaRef}
        className="scrollbar-thin flex flex-1 flex-col gap-2 overflow-y-auto bg-white px-3 py-2 text-[13px]"
      >
        {conversa.isSuccess && mensagens.length === 0 && (
          <p className="m-auto text-center text-xs text-[#8a7553]">
            Começo da conversa com {nome}. Manda um oi!
          </p>
        )}
        {mensagens.map((m) => {
          const minha = m.de_id === meuId;
          if (m.tipo === "atencao") {
            return (
              <p key={m.id} className="flex items-center gap-1.5 text-xs text-[#8a7553]">
                <BellRing className="size-3.5" />
                {minha ? `Você chamou a atenção de ${nome}!` : `${nome} chamou a sua atenção!`}
              </p>
            );
          }
          return (
            <div key={m.id}>
              <p className={cn("text-[11px]", minha ? "text-[#6b4a12]" : "text-[#9a2e1c]")}>
                {minha ? meuNome : nome} diz:{" "}
                <span className="text-[#a8987e]">{hora(m.created_at)}</span>
              </p>
              <p className="pl-2.5 break-words whitespace-pre-wrap">{m.texto}</p>
            </div>
          );
        })}
      </div>

      {/* escrever */}
      <form
        className="flex shrink-0 gap-1.5 border-t border-[#e0c99a] bg-[#fffaf0] p-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void mandar("texto");
        }}
      >
        <label htmlFor={`msn-${outro}`} className="sr-only">
          Mensagem para {nome}
        </label>
        <textarea
          id={`msn-${outro}`}
          value={texto}
          maxLength={2000}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void mandar("texto");
            }
          }}
          rows={2}
          className="min-w-0 flex-1 resize-none rounded-[3px] border border-[#cdb27a] bg-white px-2 py-1 text-[13px] text-[#2b2016] outline-none focus:border-[#a8752a]"
        />
        <button
          type="submit"
          disabled={enviando || !texto.trim()}
          className="w-16 rounded border border-[#a8752a] bg-gradient-to-b from-[#fbe3a8] to-[#e8b04f] text-xs font-bold text-[#3b2508] disabled:opacity-50"
        >
          Enviar
        </button>
      </form>
    </section>
  );
}

/** Todas as janelas abertas, flutuando por cima do app. */
export function JanelasDeConversa({ meuId, meuNome }: { meuId: string; meuNome: string }) {
  const { janelas } = useConversas();
  return (
    <>
      {janelas.map((j, i) => (
        <JanelaDeConversa key={j.userId} janela={j} meuId={meuId} meuNome={meuNome} indice={i} />
      ))}
    </>
  );
}

function ChipDeConversa({ janela }: { janela: Janela }) {
  const { abrirConversa, fechar } = useConversas();
  const pessoa = usePessoa(janela.userId);
  const nome = pessoa.data?.display_name || pessoa.data?.username || "Alguém";
  return (
    <span className="group bg-surface-2 hover:bg-surface flex max-w-full items-center gap-1.5 rounded-md py-0.5 pr-1 pl-1.5 text-xs transition-colors">
      <button
        type="button"
        onClick={() => abrirConversa(janela.userId)}
        className="flex min-w-0 items-center gap-1.5"
        title={`Abrir a conversa com ${nome}`}
      >
        <Bottlecap name={nome} src={pessoa.data?.avatar_url} className="size-5 text-[10px]" />
        <span className={cn("truncate", janela.naoLidas > 0 && "font-bold")}>{nome}</span>
        {janela.naoLidas > 0 && (
          <span className="bg-destructive text-destructive-foreground rounded-full px-1.5 text-[10px] font-bold">
            {janela.naoLidas > 99 ? "99+" : janela.naoLidas}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => fechar(janela.userId)}
        aria-label={`Fechar a conversa com ${nome}`}
        className="text-muted-foreground hover:text-foreground rounded p-0.5 opacity-60 group-hover:opacity-100"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

/**
 * As conversas minimizadas, como os botões da barra de tarefas no tempo do
 * MSN. Ficam no rodapé da barra de mesas para não cobrir o chat.
 */
export function DockDeConversas() {
  const { janelas } = useConversas();
  const minimizadas = janelas.filter((j) => j.minimizada);
  if (minimizadas.length === 0) return null;
  return (
    <div className="border-border flex flex-wrap gap-1 border-t px-2 py-1.5">
      {minimizadas.map((j) => (
        <ChipDeConversa key={j.userId} janela={j} />
      ))}
    </div>
  );
}
