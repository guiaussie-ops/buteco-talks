import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Hash, ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { Bottlecap } from "@/components/Bottlecap";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Mensagem } from "@/components/app/chat/Mensagem";
import { Compositor, type Membro } from "@/components/app/chat/Compositor";
import { useChatChannel } from "@/hooks/useChatChannel";
import {
  depoisDe,
  imagemValida,
  isGrouped,
  menciona,
  mesmoDia,
  resumoDeReacoes,
  rotuloDoDia,
  textoDigitando,
  type Message,
  type Reacao,
} from "@/lib/chat";

export type { Message } from "@/lib/chat";

type Props = {
  channelId: string;
  channelName: string;
  serverId: string;
  userId: string;
  names: Record<string, string>;
  avatars: Record<string, string | null>;
  usernames: Record<string, string>;
  /** Dono e admins apagam mensagem dos outros. */
  canManage: boolean;
};

/** Distância do fim em que a lista ainda conta como "colada embaixo". */
const COLADO_PX = 120;

function Separador({ children, destaque }: { children: React.ReactNode; destaque?: boolean }) {
  return (
    <div className="my-4 flex items-center gap-3" role="separator">
      <div className={destaque ? "bg-primary/70 h-px flex-1" : "bg-border h-px flex-1"} />
      <span
        className={
          destaque
            ? "text-primary text-[11px] font-semibold tracking-[0.14em] uppercase"
            : "text-muted-foreground text-[11px] font-medium"
        }
      >
        {children}
      </span>
      <div className={destaque ? "bg-primary/70 h-px flex-1" : "bg-border h-px flex-1"} />
    </div>
  );
}

export function ChatPanel({
  channelId,
  channelName,
  serverId,
  userId,
  names,
  avatars,
  usernames,
  canManage,
}: Props) {
  const chat = useChatChannel({ channelId, serverId, userId });
  const { messages } = chat;

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [resposta, setResposta] = useState<Message | null>(null);
  const [imagem, setImagem] = useState<File | null>(null);
  const [apagando, setApagando] = useState<Message | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [carregandoAntigas, setCarregandoAntigas] = useState(false);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const divisorRef = useRef<HTMLDivElement | null>(null);
  const coladoRef = useRef(true);
  const posicionouRef = useRef(false);
  const ultimoIdRef = useRef<string | null>(null);
  const ajusteRef = useRef<{ altura: number; topo: number } | null>(null);

  const porId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  const reacoesPorMensagem = useMemo(() => {
    const mapa = new Map<string, Reacao[]>();
    chat.reacoes.forEach((r) => {
      const lista = mapa.get(r.message_id);
      if (lista) lista.push(r);
      else mapa.set(r.message_id, [r]);
    });
    return new Map([...mapa].map(([id, lista]) => [id, resumoDeReacoes(lista)]));
  }, [chat.reacoes]);

  const divisorIdx = useMemo(
    () => messages.findIndex((m) => depoisDe(m, chat.limiar, userId)),
    [messages, chat.limiar, userId],
  );

  const membros = useMemo<Membro[]>(
    () =>
      Object.entries(usernames)
        .filter(([id]) => id !== userId)
        .map(([id, username]) => ({
          userId: id,
          username,
          name: names[id] ?? username,
          avatar: avatars[id] ?? null,
        })),
    [usernames, names, avatars, userId],
  );

  // -------------------------------------------------------------------------
  // Rolagem
  // -------------------------------------------------------------------------

  const irProFim = useCallback(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || !chat.carregado) return;

    // Primeira vez: abre na linha de "novas" se houver, senão no fim.
    if (!posicionouRef.current) {
      posicionouRef.current = true;
      ultimoIdRef.current = messages.at(-1)?.id ?? null;
      if (divisorRef.current) divisorRef.current.scrollIntoView({ block: "center" });
      else irProFim();
      return;
    }

    // Carregou antigas em cima: segura a tela onde ela estava.
    if (ajusteRef.current) {
      el.scrollTop = el.scrollHeight - ajusteRef.current.altura + ajusteRef.current.topo;
      ajusteRef.current = null;
      return;
    }

    const ultima = messages.at(-1);
    if (ultima && ultima.id !== ultimoIdRef.current) {
      ultimoIdRef.current = ultima.id;
      // Chegou mensagem embaixo: acompanha se eu já estava no fim ou se fui eu
      // que mandei. Quem subiu para ler o histórico não é puxado de volta.
      if (coladoRef.current || ultima.user_id === userId) irProFim();
    }
  }, [messages, chat.carregado, userId, irProFim]);

  const aoRolar = async () => {
    const el = scrollerRef.current;
    if (!el) return;
    coladoRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < COLADO_PX;
    if (el.scrollTop < 80 && chat.temMais && !carregandoAntigas) {
      setCarregandoAntigas(true);
      ajusteRef.current = { altura: el.scrollHeight, topo: el.scrollTop };
      const quantas = await chat.carregarAntigas();
      if (quantas === 0) ajusteRef.current = null;
      setCarregandoAntigas(false);
    }
  };

  // Imagem que termina de carregar empurra a lista; quem está no fim continua no fim.
  const aoCarregarImagem = useCallback(() => {
    if (coladoRef.current) irProFim();
  }, [irProFim]);

  const irPara = (id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) {
      toast.info("Essa mensagem é antiga demais, sobe a conversa até ela.");
      return;
    }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("bg-primary/15");
    window.setTimeout(() => el.classList.remove("bg-primary/15"), 1500);
  };

  // Mensagem apagada (por mim em outra aba, ou por um admin) não pode ficar
  // presa em edição nem como alvo de resposta.
  useEffect(() => {
    if (editandoId && !porId.has(editandoId)) setEditandoId(null);
    if (resposta && !porId.has(resposta.id)) setResposta(null);
  }, [porId, editandoId, resposta]);

  // -------------------------------------------------------------------------
  // Ações
  // -------------------------------------------------------------------------

  const enviar = async (texto: string) => {
    const ok = await chat.enviar({ texto, replyTo: resposta?.id ?? null, imagem });
    if (ok) {
      setResposta(null);
      setImagem(null);
    }
    return ok;
  };

  const editarUltima = () => {
    const minha = [...messages].reverse().find((m) => m.user_id === userId && m.content);
    if (minha) setEditandoId(minha.id);
  };

  const soltar = (e: React.DragEvent) => {
    e.preventDefault();
    setArrastando(false);
    const arquivo = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
    if (arquivo && imagemValida(arquivo)) setImagem(arquivo);
  };

  const digitandoTexto = textoDigitando(chat.digitando.map((id) => names[id] ?? "Alguém"));

  return (
    <section
      className="relative flex h-full min-w-0 flex-1 flex-col"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setArrastando(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setArrastando(false);
      }}
      onDrop={soltar}
    >
      <header className="border-border flex h-14 shrink-0 items-center gap-2 border-b px-5">
        <Hash className="text-primary size-4" />
        <h1 className="font-display text-base tracking-wide">{channelName}</h1>
        <span className="text-muted-foreground ml-2 text-xs">mesa de texto</span>
      </header>

      <div
        ref={scrollerRef}
        onScroll={() => void aoRolar()}
        className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4"
      >
        {chat.carregado && messages.length === 0 && (
          <div className="flex h-full min-h-60 flex-col items-center justify-center gap-2 text-center">
            <Bottlecap name={channelName} className="size-12" />
            <p className="text-muted-foreground max-w-xs text-sm">
              A mesa tá vazia... Solta a primeira resenha pra esquentar o ambiente.
            </p>
          </div>
        )}

        {chat.carregado && messages.length > 0 && !chat.temMais && (
          <div className="mb-6 flex flex-col items-start gap-2 px-1 pt-6">
            <Bottlecap name={channelName} className="size-12" />
            <h2 className="font-display text-2xl tracking-wide">Começo de #{channelName}</h2>
            <p className="text-muted-foreground text-sm">Daqui pra trás não tem mais resenha.</p>
          </div>
        )}
        {carregandoAntigas && (
          <p className="text-muted-foreground py-2 text-center text-xs">Puxando as antigas…</p>
        )}

        <div>
          {messages.map((m, i) => {
            const anterior = messages[i - 1];
            const novoDia = !anterior || !mesmoDia(anterior.created_at, m.created_at);
            const ehDivisor = i === divisorIdx;
            const citada = m.reply_to
              ? (porId.get(m.reply_to) ?? chat.citadas[m.reply_to])
              : undefined;
            return (
              <Fragment key={m.id}>
                {novoDia && <Separador>{rotuloDoDia(m.created_at)}</Separador>}
                {ehDivisor && (
                  <div ref={divisorRef}>
                    <Separador destaque>Novas mensagens</Separador>
                  </div>
                )}
                <Mensagem
                  msg={m}
                  agrupada={!ehDivisor && isGrouped(anterior, m)}
                  userId={userId}
                  names={names}
                  avatars={avatars}
                  usernames={usernames}
                  citada={citada}
                  urlImagem={m.image_path ? chat.urls[m.image_path] : undefined}
                  reacoes={reacoesPorMensagem.get(m.id) ?? []}
                  mencionaMe={m.user_id !== userId && menciona(m.content, userId, usernames)}
                  podeApagar={m.user_id === userId || canManage}
                  editando={editandoId === m.id}
                  onComecarEdicao={() => setEditandoId(m.id)}
                  onSalvarEdicao={async (texto) => {
                    // Apagar todo o texto de uma mensagem sem imagem é apagar a mensagem.
                    if (!texto && !m.image_path) {
                      setEditandoId(null);
                      setApagando(m);
                      return false;
                    }
                    return chat.editar(m.id, texto);
                  }}
                  onCancelarEdicao={() => setEditandoId(null)}
                  onResponder={() => setResposta(m)}
                  onApagar={(semPerguntar) => (semPerguntar ? void chat.apagar(m) : setApagando(m))}
                  onReagir={(emoji) => void chat.alternarReacao(m.id, emoji)}
                  onIrPara={irPara}
                  onImagemCarregou={aoCarregarImagem}
                />
              </Fragment>
            );
          })}
        </div>
      </div>

      <Compositor
        channelName={channelName}
        membros={membros}
        resposta={resposta ? { msg: resposta, nome: names[resposta.user_id] ?? "Alguém" } : null}
        onCancelarResposta={() => setResposta(null)}
        imagem={imagem}
        onImagem={setImagem}
        onEnviar={enviar}
        onDigitando={chat.avisarDigitando}
        onEditarUltima={editarUltima}
        digitandoTexto={digitandoTexto}
      />

      {arrastando && (
        <div className="bg-background/80 border-primary pointer-events-none absolute inset-3 z-30 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed">
          <ImagePlus className="text-primary size-10" />
          <p className="font-display text-lg tracking-wide">Solta a imagem em #{channelName}</p>
        </div>
      )}

      <AlertDialog open={!!apagando} onOpenChange={(aberto) => !aberto && setApagando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar mensagem?</AlertDialogTitle>
            <AlertDialogDescription>
              Some pra todo mundo da mesa, junto com as reações. Dica: Shift + clique na lixeira
              apaga sem perguntar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {apagando && (
            <div className="bg-surface text-foreground/90 max-h-32 overflow-hidden rounded-lg p-3 text-sm break-words whitespace-pre-wrap">
              {apagando.content || <span className="text-muted-foreground italic">imagem</span>}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (apagando) void chat.apagar(apagando);
                setApagando(null);
              }}
            >
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
