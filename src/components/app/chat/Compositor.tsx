import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, SendHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Bottlecap } from "@/components/Bottlecap";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { IMAGEM_TIPOS, imagemValida, mencaoEmAndamento, type Message } from "@/lib/chat";

export type Membro = { userId: string; name: string; username: string; avatar: string | null };

type Props = {
  channelName: string;
  membros: Membro[];
  resposta: { msg: Message; nome: string } | null;
  onCancelarResposta: () => void;
  imagem: File | null;
  onImagem: (arquivo: File | null) => void;
  onEnviar: (texto: string) => Promise<boolean>;
  onDigitando: () => void;
  /** Seta para cima com a caixa vazia: edita a minha última mensagem. */
  onEditarUltima: () => void;
  digitandoTexto: string;
};

export function Compositor({
  channelName,
  membros,
  resposta,
  onCancelarResposta,
  imagem,
  onImagem,
  onEnviar,
  onDigitando,
  onEditarUltima,
  digitandoTexto,
}: Props) {
  const [draft, setDraft] = useState("");
  const [cursor, setCursor] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [escolhido, setEscolhido] = useState(0);
  const [fechouSugestao, setFechouSugestao] = useState(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const arquivoRef = useRef<HTMLInputElement | null>(null);

  // Responder leva o foco para a caixa, como no clique de "Responder" do Discord.
  useEffect(() => {
    if (resposta) ref.current?.focus();
  }, [resposta]);

  const previa = useMemo(() => (imagem ? URL.createObjectURL(imagem) : null), [imagem]);
  useEffect(
    () => () => {
      if (previa) URL.revokeObjectURL(previa);
    },
    [previa],
  );

  const andamento = fechouSugestao ? null : mencaoEmAndamento(draft, cursor);
  const sugestoes = useMemo(() => {
    if (!andamento) return [];
    const termo = andamento.termo.toLowerCase();
    return membros
      .map((m) => {
        const u = m.username.toLowerCase();
        const n = m.name.toLowerCase();
        const nota =
          u.startsWith(termo) || n.startsWith(termo)
            ? 0
            : u.includes(termo) || n.includes(termo)
              ? 1
              : -1;
        return { m, nota };
      })
      .filter((x) => x.nota >= 0)
      .sort((a, b) => a.nota - b.nota || a.m.name.localeCompare(b.m.name))
      .slice(0, 8)
      .map((x) => x.m);
  }, [andamento, membros]);

  useEffect(() => setEscolhido(0), [andamento?.termo]);

  const completar = (m: Membro) => {
    if (!andamento) return;
    const antes = draft.slice(0, andamento.inicio) + "@" + m.username + " ";
    const novo = antes + draft.slice(cursor);
    setDraft(novo);
    setCursor(antes.length);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(antes.length, antes.length);
    });
  };

  const enviar = async () => {
    const texto = draft.trim();
    if ((!texto && !imagem) || enviando) return;
    setEnviando(true);
    const ok = await onEnviar(texto);
    setEnviando(false);
    if (ok) {
      setDraft("");
      setCursor(0);
    }
    ref.current?.focus();
  };

  const colar = (e: React.ClipboardEvent) => {
    const arquivo = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
    if (!arquivo) return;
    e.preventDefault();
    if (imagemValida(arquivo)) onImagem(arquivo);
  };

  return (
    <div className="border-border shrink-0 border-t px-4 pt-3 pb-1">
      {resposta && (
        <div className="bg-surface-2/60 text-muted-foreground mb-2 flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs">
          <span className="min-w-0 flex-1 truncate">
            Respondendo a <span className="text-foreground font-semibold">{resposta.nome}</span>
            {resposta.msg.content && (
              <span className="ml-1.5 opacity-80">— {resposta.msg.content}</span>
            )}
          </span>
          <button
            title="Cancelar resposta"
            onClick={onCancelarResposta}
            className="hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {previa && (
        <div className="bg-surface relative mb-2 w-fit rounded-lg p-2">
          <img
            src={previa}
            alt="Imagem a enviar"
            className="max-h-32 max-w-60 rounded object-contain"
          />
          <button
            title="Tirar imagem"
            onClick={() => onImagem(null)}
            className="bg-background text-muted-foreground hover:text-destructive border-border absolute -top-2 -right-2 rounded-full border p-1"
          >
            <X className="size-3" />
          </button>
        </div>
      )}

      <div className="relative">
        {sugestoes.length > 0 && (
          <ul className="bg-surface border-border absolute bottom-full left-0 z-20 mb-2 w-72 overflow-hidden rounded-lg border py-1 shadow-lg">
            <li className="text-muted-foreground px-3 pt-1 pb-1.5 text-[10px] font-semibold tracking-[0.14em] uppercase">
              Membros
            </li>
            {sugestoes.map((m, i) => (
              <li key={m.userId}>
                <button
                  // mousedown, e não click: o click tiraria o foco da caixa antes.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    completar(m);
                  }}
                  onMouseEnter={() => setEscolhido(i)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                    i === escolhido && "bg-surface-2",
                  )}
                >
                  <Bottlecap name={m.name} src={m.avatar} className="size-6 text-[10px]" />
                  <span className="truncate">{m.name}</span>
                  <span className="text-muted-foreground ml-auto truncate text-xs">
                    @{m.username}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="bg-surface wood-texture flex items-end gap-1 rounded-xl p-2">
          <input
            ref={arquivoRef}
            type="file"
            accept={IMAGEM_TIPOS.join(",")}
            className="hidden"
            onChange={(e) => {
              const arquivo = e.target.files?.[0];
              e.target.value = "";
              if (arquivo && imagemValida(arquivo)) onImagem(arquivo);
            }}
          />
          <Button
            size="icon"
            variant="ghost"
            title="Mandar imagem"
            className="text-muted-foreground shrink-0"
            onClick={() => arquivoRef.current?.click()}
          >
            <ImagePlus className="size-4" />
          </Button>
          <Textarea
            ref={ref}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setCursor(e.target.selectionStart);
              setFechouSugestao(false);
              if (e.target.value.trim()) onDigitando();
            }}
            onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
            onPaste={colar}
            onKeyDown={(e) => {
              if (sugestoes.length > 0) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const passo = e.key === "ArrowDown" ? 1 : -1;
                  setEscolhido((i) => (i + passo + sugestoes.length) % sugestoes.length);
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  completar(sugestoes[escolhido]!);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setFechouSugestao(true);
                  return;
                }
              }
              if (e.key === "Escape" && resposta) {
                e.preventDefault();
                onCancelarResposta();
                return;
              }
              if (e.key === "ArrowUp" && !draft && !imagem) {
                e.preventDefault();
                onEditarUltima();
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void enviar();
              }
            }}
            rows={1}
            placeholder={`Solta a resenha em #${channelName}`}
            className="max-h-40 min-h-10 resize-none border-0 bg-transparent focus-visible:ring-0"
          />
          <Button
            size="icon"
            className="shrink-0"
            onClick={() => void enviar()}
            disabled={enviando || (!draft.trim() && !imagem)}
          >
            <SendHorizontal className="size-4" />
          </Button>
        </div>
      </div>

      <p className="text-muted-foreground h-5 truncate px-1 pt-0.5 text-[11px]" aria-live="polite">
        {digitandoTexto}
      </p>
    </div>
  );
}
