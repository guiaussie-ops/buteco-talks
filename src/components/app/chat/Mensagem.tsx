import { useEffect, useRef, useState } from "react";
import { CornerUpLeft, ImageIcon, Pencil, Reply, SmilePlus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Bottlecap } from "@/components/Bottlecap";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EMOJIS_RAPIDOS, formatDay, formatTime, trechos, type Message } from "@/lib/chat";

type ReacaoResumo = { emoji: string; userIds: string[] };

type Props = {
  msg: Message;
  agrupada: boolean;
  userId: string;
  names: Record<string, string>;
  avatars: Record<string, string | null>;
  usernames: Record<string, string>;
  /**
   * A mensagem citada, quando já está à mão. Não existe "citação apagada": o
   * ON DELETE SET NULL zera o reply_to e o Realtime traz a linha sem citação.
   */
  citada: Message | undefined;
  urlImagem: string | undefined;
  reacoes: ReacaoResumo[];
  mencionaMe: boolean;
  podeApagar: boolean;
  editando: boolean;
  onComecarEdicao: () => void;
  onSalvarEdicao: (texto: string) => Promise<boolean>;
  onCancelarEdicao: () => void;
  onResponder: () => void;
  onApagar: (semPerguntar: boolean) => void;
  onReagir: (emoji: string) => void;
  onIrPara: (id: string) => void;
  onImagemCarregou: () => void;
};

export function TextoComMencoes({
  texto,
  usernames,
  names,
  userId,
}: {
  texto: string;
  usernames: Record<string, string>;
  names: Record<string, string>;
  userId: string;
}) {
  return (
    <>
      {trechos(texto, usernames).map((t, i) =>
        t.tipo === "texto" ? (
          <span key={i}>{t.texto}</span>
        ) : (
          <span
            key={i}
            title={t.texto}
            className={cn(
              "rounded px-0.5 font-medium",
              t.userId === userId ? "bg-primary/25 text-primary" : "bg-primary/10 text-primary/90",
            )}
          >
            @{names[t.userId] ?? t.texto.slice(1)}
          </span>
        ),
      )}
    </>
  );
}

function Citacao({
  citada,
  names,
  usernames,
  userId,
  onIrPara,
}: {
  citada: Message;
  names: Record<string, string>;
  usernames: Record<string, string>;
  userId: string;
  onIrPara: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onIrPara(citada.id)}
      className="text-muted-foreground hover:text-foreground mb-0.5 flex max-w-full min-w-0 items-center gap-1.5 pl-[52px] text-left text-xs"
    >
      <CornerUpLeft className="size-3 shrink-0" />
      <span className="shrink-0 font-semibold">{names[citada.user_id] ?? "Alguém"}</span>
      <span className="truncate">
        {citada.content ? (
          <TextoComMencoes
            texto={citada.content}
            usernames={usernames}
            names={names}
            userId={userId}
          />
        ) : (
          <span className="inline-flex items-center gap-1 italic">
            <ImageIcon className="size-3" /> imagem
          </span>
        )}
      </span>
    </button>
  );
}

function EdicaoEmLinha({
  inicial,
  onSalvar,
  onCancelar,
}: {
  inicial: string;
  onSalvar: (texto: string) => Promise<boolean>;
  onCancelar: () => void;
}) {
  const [texto, setTexto] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const salvar = async () => {
    if (texto.trim() === inicial.trim()) return onCancelar();
    setSalvando(true);
    const ok = await onSalvar(texto.trim());
    setSalvando(false);
    if (ok) onCancelar();
  };

  return (
    <div className="mt-1 w-full">
      <Textarea
        ref={ref}
        value={texto}
        disabled={salvando}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancelar();
          } else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void salvar();
          }
        }}
        rows={1}
        className="bg-surface max-h-60 min-h-10 resize-none text-sm"
      />
      <p className="text-muted-foreground mt-1 text-[11px]">
        Esc para{" "}
        <button className="text-primary hover:underline" onClick={onCancelar}>
          cancelar
        </button>{" "}
        · Enter para{" "}
        <button className="text-primary hover:underline" onClick={() => void salvar()}>
          salvar
        </button>
      </p>
    </div>
  );
}

function SeletorDeEmoji({
  onEscolher,
  children,
}: {
  onEscolher: (e: string) => void;
  children: React.ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-2">
        <div className="grid grid-cols-8 gap-1">
          {EMOJIS_RAPIDOS.map((e) => (
            <button
              key={e}
              onClick={() => {
                onEscolher(e);
                setAberto(false);
              }}
              className="hover:bg-surface-2 rounded p-1 text-xl leading-none"
            >
              {e}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Repassa props e ref: dentro do PopoverTrigger com asChild, é ele que recebe os handlers. */
function BotaoDeAcao({
  titulo,
  children,
  perigo,
  ...resto
}: React.ComponentProps<"button"> & { titulo: string; perigo?: boolean }) {
  return (
    <button
      {...resto}
      title={titulo}
      aria-label={titulo}
      className={cn(
        "text-muted-foreground hover:bg-surface-2 rounded p-1.5",
        perigo ? "hover:text-destructive" : "hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function Mensagem({
  msg,
  agrupada,
  userId,
  names,
  avatars,
  usernames,
  citada,
  urlImagem,
  reacoes,
  mencionaMe,
  podeApagar,
  editando,
  onComecarEdicao,
  onSalvarEdicao,
  onCancelarEdicao,
  onResponder,
  onApagar,
  onReagir,
  onIrPara,
  onImagemCarregou,
}: Props) {
  const name = names[msg.user_id] ?? "Alguém";
  const minha = msg.user_id === userId;

  const corpo = editando ? (
    <EdicaoEmLinha inicial={msg.content} onSalvar={onSalvarEdicao} onCancelar={onCancelarEdicao} />
  ) : (
    <>
      {msg.content && (
        <p className="text-foreground/90 text-sm break-words whitespace-pre-wrap">
          <TextoComMencoes
            texto={msg.content}
            usernames={usernames}
            names={names}
            userId={userId}
          />
          {msg.edited_at && (
            <span
              className="text-muted-foreground/70 ml-1 text-[10px]"
              title={`Editada ${formatDay(msg.edited_at)} às ${formatTime(msg.edited_at)}`}
            >
              (editada)
            </span>
          )}
        </p>
      )}
      {msg.image_path && (
        <a
          href={urlImagem}
          target="_blank"
          rel="noreferrer"
          className="bg-surface mt-1 block w-fit overflow-hidden rounded-lg"
        >
          {urlImagem ? (
            <img
              src={urlImagem}
              alt="Imagem enviada"
              loading="lazy"
              onLoad={onImagemCarregou}
              className="max-h-80 max-w-full object-contain sm:max-w-sm"
            />
          ) : (
            <div className="text-muted-foreground flex h-40 w-60 items-center justify-center">
              <ImageIcon className="size-6 animate-pulse" />
            </div>
          )}
        </a>
      )}
      {reacoes.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {reacoes.map((r) => {
            const reagi = r.userIds.includes(userId);
            return (
              <button
                key={r.emoji}
                onClick={() => onReagir(r.emoji)}
                title={r.userIds.map((id) => names[id] ?? "Alguém").join(", ")}
                className={cn(
                  "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
                  reagi
                    ? "border-primary/60 bg-primary/15 text-primary"
                    : "border-border bg-surface hover:border-primary/40",
                )}
              >
                <span className="text-sm leading-none">{r.emoji}</span>
                <span className="tabular-nums">{r.userIds.length}</span>
              </button>
            );
          })}
          <SeletorDeEmoji onEscolher={onReagir}>
            <button
              title="Reagir"
              className="border-border bg-surface text-muted-foreground hover:text-foreground hover:border-primary/40 flex items-center rounded-full border px-1.5 py-0.5"
            >
              <SmilePlus className="size-3.5" />
            </button>
          </SeletorDeEmoji>
        </div>
      )}
    </>
  );

  return (
    <div
      id={`msg-${msg.id}`}
      className={cn(
        "group hover:bg-surface/50 relative rounded-md pr-2 transition-colors",
        agrupada ? "py-0.5" : "mt-3 pt-1 pb-0.5",
        mencionaMe && "border-primary bg-primary/[0.07] hover:bg-primary/10 border-l-2",
      )}
    >
      {citada && (
        <Citacao
          citada={citada}
          names={names}
          usernames={usernames}
          userId={userId}
          onIrPara={onIrPara}
        />
      )}

      {agrupada ? (
        <div className="flex">
          <span className="text-muted-foreground invisible w-[52px] shrink-0 pt-0.5 pr-2 text-right text-[10px] group-hover:visible">
            {formatTime(msg.created_at)}
          </span>
          <div className="min-w-0 flex-1">{corpo}</div>
        </div>
      ) : (
        <div className="flex gap-3 pl-1">
          <Bottlecap name={name} src={avatars[msg.user_id]} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="flex items-baseline gap-2">
              <span className="text-sm font-semibold">{name}</span>
              <span className="text-muted-foreground text-[11px]">
                {formatDay(msg.created_at)} às {formatTime(msg.created_at)}
              </span>
            </p>
            {corpo}
          </div>
        </div>
      )}

      {!editando && (
        <div className="bg-surface border-border absolute -top-3 right-2 hidden items-center rounded-md border shadow-sm group-hover:flex has-[[data-state=open]]:flex">
          <SeletorDeEmoji onEscolher={onReagir}>
            <BotaoDeAcao titulo="Reagir">
              <SmilePlus className="size-4" />
            </BotaoDeAcao>
          </SeletorDeEmoji>
          <BotaoDeAcao titulo="Responder" onClick={onResponder}>
            <Reply className="size-4" />
          </BotaoDeAcao>
          {minha && (
            <BotaoDeAcao titulo="Editar" onClick={onComecarEdicao}>
              <Pencil className="size-4" />
            </BotaoDeAcao>
          )}
          {podeApagar && (
            <BotaoDeAcao
              titulo="Apagar (Shift: sem perguntar)"
              perigo
              onClick={(e) => onApagar(e.shiftKey)}
            >
              <Trash2 className="size-4" />
            </BotaoDeAcao>
          )}
        </div>
      )}
    </div>
  );
}
