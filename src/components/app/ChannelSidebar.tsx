import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  FolderInput,
  FolderPlus,
  Hash,
  LayoutGrid,
  Plus,
  UserPlus,
  Users,
  Volume2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Bottlecap } from "@/components/Bottlecap";
import { InviteDialog } from "@/components/app/InviteDialog";
import { Letreiro, type ServerItem } from "@/components/app/Letreiro";
import { DockDeConversas } from "@/components/app/Conversas";
import { MeuStatus } from "@/components/app/MeuStatus";
import { MiniMesa } from "@/components/app/Mesas";
import { VoiceBar } from "@/components/app/VoiceBar";
import { useVoice } from "@/lib/voice";
import { useAuth } from "@/lib/auth";
import { usePerfil } from "@/lib/perfil";
import {
  ControleDeVolume,
  SeloDeMicFechado,
  SeloDeMudo,
  useAudioDoParticipante,
} from "@/components/app/ControleDeVolume";
import type { NaoLidas } from "@/hooks/useNaoLidas";
import {
  arrumacaoDe,
  deslocarCategoria,
  deslocarMesa,
  montarBlocos,
  moverCategoria,
  moverMesa,
  type Arrumacao,
  type Bloco,
  type Categoria,
} from "@/lib/organizacao";
import { Settings, MoreVertical, Pencil, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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

export type Channel = {
  id: string;
  name: string;
  kind: string;
  server_id: string;
  category_id: string | null;
  position: number;
};

type Props = {
  serverName: string;
  /** Os butecos da pessoa, para o letreiro trocar de um para outro. */
  servers: ServerItem[];
  onSelectServer: (id: string) => void;
  onCreateServer: () => void;
  onJoinServer: () => void;
  inviteCode: string | null;
  channels: Channel[];
  categorias: Categoria[];
  /** Grava a arrumação nova de mesas e categorias (arrastar, subir, descer, mover). */
  onOrganizar: (arrumacao: Arrumacao) => Promise<void>;
  onCriarCategoria: (name: string) => Promise<void>;
  onRenomearCategoria: (id: string, name: string) => Promise<void>;
  onApagarCategoria: (id: string) => Promise<void>;
  onOpenMembros: () => void;
  activeChannelId: string | null;
  onSelect: (c: Channel) => void;
  isOwner: boolean;
  onCreateChannel: (
    name: string,
    kind: "text" | "voice",
    categoryId: string | null,
  ) => Promise<void>;
  isAdult: boolean;
  onSignOut: () => void;
  onOpenVoiceRoom: (channelId: string) => void;
  serverId: string;
  names: Record<string, string>;
  /** Não lidas e menções por mesa de texto. */
  naoLidas: NaoLidas;
  /** Quem está sentado em cada mesa de voz (o salão usa o mesmo, por isso vem de fora). */
  roster: Record<string, string[]>;
  /** Volta para a planta do salão. */
  onOpenSalao: () => void;
  canManage: boolean;
  onOpenSettings: () => void;
  onRenameChannel: (channelId: string, name: string) => Promise<void>;
  onDeleteChannel: (channelId: string) => Promise<void>;
  onRegenerateInvite: () => Promise<void>;
  /** foto de cada membro do buteco, por id */
  avatars: Record<string, string | null>;
};

/**
 * Uma tampinha sentada na mesa de voz, na fileira embaixo da miniatura. O nome
 * vai no título e para o leitor de tela; o clique abre o volume da pessoa.
 */
function TampinhaSentada({
  userId,
  name,
  avatar,
  falando,
  ehVoce,
  micOff,
}: {
  userId: string;
  name: string;
  avatar: string | null | undefined;
  falando: boolean;
  ehVoce: boolean;
  /** O microfone DELA está fechado, segundo a presença. */
  micOff: boolean;
}) {
  const { muted } = useAudioDoParticipante(userId);

  // Mesma regra da tampinha grande no painel: o meu mudo vence o microfone
  // fechado dela, porque é ele que explica o silêncio se ela voltar a falar.
  const selo = ehVoce ? null : muted ? (
    <SeloDeMudo className="size-2.5" />
  ) : micOff ? (
    <SeloDeMicFechado className="size-2.5" />
  ) : null;

  const tampinha = (
    <span className="relative block">
      <Bottlecap
        name={name}
        src={avatar}
        speaking={falando}
        className={cn(
          "size-7 text-[11px]",
          ehVoce && "ring-foreground/70 ring-2 ring-offset-1 ring-offset-transparent",
        )}
      />
      {selo && (
        <span className="bg-background/90 absolute -right-1 -bottom-1 rounded-full p-0.5">
          {selo}
        </span>
      )}
      <span className="sr-only">{ehVoce ? `${name} (você)` : name}</span>
    </span>
  );

  // Ninguém se escuta na mesa, então a própria tampinha não abre controle nenhum.
  if (ehVoce) return <span title={`${name} (você)`}>{tampinha}</span>;

  return (
    <ControleDeVolume userId={userId} name={name} align="start" className="rounded-full">
      <span title={name}>{tampinha}</span>
    </ControleDeVolume>
  );
}

/** O que está sendo arrastado e onde a soltura cairia, para desenhar a marca. */
type Arraste = { tipo: "mesa" | "categoria"; id: string };
type Alvo =
  | { tipo: "antes-da-mesa"; id: string }
  | { tipo: "fim-da-categoria"; id: string | null }
  | { tipo: "antes-da-categoria"; id: string | null };

const mesmoAlvo = (a: Alvo | null, b: Alvo) => !!a && a.tipo === b.tipo && a.id === b.id;

export function ChannelSidebar({
  serverName,
  servers,
  onSelectServer,
  onCreateServer,
  onJoinServer,
  inviteCode,
  channels,
  categorias,
  onOrganizar,
  onCriarCategoria,
  onRenomearCategoria,
  onApagarCategoria,
  onOpenMembros,
  activeChannelId,
  onSelect,
  isOwner,
  onCreateChannel,
  isAdult,
  onSignOut,
  onOpenVoiceRoom,
  serverId,
  names,
  naoLidas,
  roster,
  onOpenSalao,
  canManage,
  onOpenSettings,
  onRenameChannel,
  onDeleteChannel,
  onRegenerateInvite,
  avatars,
}: Props) {
  const [open, setOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"text" | "voice">("text");
  /** Categoria em que a mesa nova vai nascer ("" = sem categoria). */
  const [categoriaDaNova, setCategoriaDaNova] = useState("");
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState<Channel | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<Channel | null>(null);
  const [recolhidas, setRecolhidas] = useState<Set<string>>(() => new Set());
  const [arraste, setArraste] = useState<Arraste | null>(null);
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  /** Diálogo de categoria: criar (id null) ou renomear. */
  const [editandoCategoria, setEditandoCategoria] = useState<{
    id: string | null;
    nome: string;
  } | null>(null);
  const [apagandoCategoria, setApagandoCategoria] = useState<Categoria | null>(null);

  const blocos = useMemo(() => montarBlocos(categorias, channels), [categorias, channels]);

  const voiceSession = useVoice();
  const { session } = useAuth();
  const meuId = session?.user.id ?? null;
  const { abrirPerfil } = usePerfil();

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await onCreateChannel(
      name.trim().toLowerCase().replace(/\s+/g, "-"),
      kind,
      categoriaDaNova || null,
    );
    setSaving(false);
    setName("");
    setOpen(false);
  };

  const novaMesa = (categoriaId: string | null) => {
    setCategoriaDaNova(categoriaId ?? "");
    setOpen(true);
  };

  /** As funções de `organizacao` devolvem o mesmo objeto quando nada muda. */
  const organizar = (novos: Bloco<Channel>[]) => {
    if (novos !== blocos) void onOrganizar(arrumacaoDe(novos));
  };

  const alternarRecolhida = (id: string) =>
    setRecolhidas((prev) => {
      const novo = new Set(prev);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });

  // ---------------------------------------------------------------------------
  // Arrastar e soltar (só para quem arruma o buteco). No celular não há
  // arrastar nativo; lá valem o "Subir", "Descer" e "Mover para" dos menus.
  // ---------------------------------------------------------------------------

  const comecarArraste = (e: React.DragEvent, a: Arraste) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = "move";
    // O Firefox só começa o arraste se tiver algum dado junto.
    e.dataTransfer.setData("text/plain", a.id);
    setArraste(a);
  };

  const terminarArraste = () => {
    setArraste(null);
    setAlvo(null);
  };

  const soltar = (destino: Alvo) => {
    if (!arraste) return;
    if (destino.tipo === "antes-da-mesa")
      organizar(moverMesa(blocos, arraste.id, { antesDe: destino.id }));
    else if (destino.tipo === "fim-da-categoria")
      organizar(moverMesa(blocos, arraste.id, { fimDe: destino.id }));
    else organizar(moverCategoria(blocos, arraste.id, destino.id));
    terminarArraste();
  };

  /** Liga um elemento como alvo, aceitando só o tipo de arraste que faz sentido ali. */
  const zonaDeSoltura = (aceita: Arraste["tipo"], destino: Alvo) => ({
    onDragOver: (e: React.DragEvent) => {
      if (arraste?.tipo !== aceita) return;
      e.preventDefault();
      e.stopPropagation();
      if (!mesmoAlvo(alvo, destino)) setAlvo(destino);
    },
    onDrop: (e: React.DragEvent) => {
      if (arraste?.tipo !== aceita) return;
      e.preventDefault();
      e.stopPropagation();
      soltar(destino);
    },
  });

  const renderMesa = (c: Channel, bloco: Bloco<Channel>) => {
    const seated = roster[c.id] ?? [];
    const nomesSentados = seated.map((id) => names[id] ?? "Participante");
    // A mesa aberta nunca acende: o que chega nela já está sendo lido.
    const pendente = activeChannelId === c.id ? undefined : naoLidas[c.id];
    const temNovas = !!pendente && pendente.naoLidas > 0;
    const mencoes = pendente?.mencoes ?? 0;
    const indice = bloco.mesas.indexOf(c);
    const outrasCategorias = [
      ...(bloco.categoria ? [{ id: null as string | null, name: "Sem categoria" }] : []),
      ...categorias.filter((k) => k.id !== bloco.categoria?.id),
    ];
    const destinoAqui: Alvo = { tipo: "antes-da-mesa", id: c.id };

    const acoes = (Item: typeof DropdownMenuItem | typeof ContextMenuItem) => (
      <>
        <Item
          onSelect={() => {
            setRenameValue(c.name);
            setRenaming(c);
          }}
        >
          <Pencil className="size-4" /> Renomear
        </Item>
        <Item disabled={indice <= 0} onSelect={() => organizar(deslocarMesa(blocos, c.id, -1))}>
          <ArrowUp className="size-4" /> Subir
        </Item>
        <Item
          disabled={indice >= bloco.mesas.length - 1}
          onSelect={() => organizar(deslocarMesa(blocos, c.id, 1))}
        >
          <ArrowDown className="size-4" /> Descer
        </Item>
        <Item className="text-destructive focus:text-destructive" onSelect={() => setDeleting(c)}>
          <Trash2 className="size-4" /> Apagar mesa
        </Item>
      </>
    );

    return (
      <div
        key={c.id}
        draggable={canManage}
        onDragStart={(e) => comecarArraste(e, { tipo: "mesa", id: c.id })}
        onDragEnd={terminarArraste}
        {...(canManage ? zonaDeSoltura("mesa", destinoAqui) : {})}
        className={cn(
          "border-t-2 border-transparent",
          mesmoAlvo(alvo, destinoAqui) && "border-primary",
          arraste?.id === c.id && "opacity-40",
        )}
      >
        <ContextMenu>
          <ContextMenuTrigger disabled={!canManage} asChild>
            <div className="group/mesa relative">
              {temNovas && (
                <span
                  aria-hidden
                  className="bg-foreground absolute top-1/2 -left-2 h-2 w-1 -translate-y-1/2 rounded-r-full"
                />
              )}
              <button
                onClick={() => onSelect(c)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors",
                  activeChannelId === c.id
                    ? "bg-primary/15 text-foreground shadow-[inset_3px_0_0_var(--color-primary)]"
                    : temNovas
                      ? "text-foreground hover:bg-surface-2/60 font-semibold"
                      : "text-muted-foreground hover:bg-surface-2/60 hover:text-foreground",
                )}
              >
                <MiniMesa
                  tipo={c.kind === "voice" ? "voice" : "text"}
                  sentados={nomesSentados}
                  apagada={
                    c.kind === "voice" ? seated.length === 0 : !temNovas && activeChannelId !== c.id
                  }
                />
                <span className="truncate">{c.name}</span>
                {mencoes > 0 && (
                  <span
                    title={`${mencoes} ${mencoes === 1 ? "menção" : "menções"}`}
                    className={cn(
                      "bg-destructive text-destructive-foreground ml-auto min-w-[18px] shrink-0 rounded-full px-1.5 text-center text-[10px] leading-[18px] font-bold tabular-nums",
                      canManage && "group-hover/mesa:opacity-0",
                    )}
                  >
                    {mencoes > 99 ? "99+" : mencoes}
                  </span>
                )}
              </button>

              {canManage && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      title="Ações da mesa"
                      className="text-muted-foreground hover:text-foreground hover:bg-surface-2 absolute top-1/2 right-1 hidden -translate-y-1/2 rounded p-0.5 group-hover/mesa:block data-[state=open]:block"
                    >
                      <MoreVertical className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    {acoes(DropdownMenuItem)}
                    {outrasCategorias.length > 0 && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                            <FolderInput className="size-4" /> Mover para
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className="w-44">
                            {outrasCategorias.map((k) => (
                              <DropdownMenuItem
                                key={k.id ?? "soltas"}
                                onSelect={() => organizar(moverMesa(blocos, c.id, { fimDe: k.id }))}
                              >
                                <span className="truncate">{k.name}</span>
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-40">{acoes(ContextMenuItem)}</ContextMenuContent>
        </ContextMenu>

        {/* quem está sentado agora — visível pra todo mundo do buteco */}
        {c.kind === "voice" && seated.length > 0 && (
          <ul className="mt-1 mb-1.5 flex flex-wrap gap-1.5 pl-[50px]">
            {seated
              .map((userId) => ({ userId, name: names[userId] ?? "Participante" }))
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(({ userId, name }) => (
                <li key={userId}>
                  <TampinhaSentada
                    userId={userId}
                    name={name}
                    avatar={avatars[userId]}
                    falando={
                      voiceSession.active?.channelId === c.id && !!voiceSession.speaking[userId]
                    }
                    ehVoce={userId === meuId}
                    // Só vale para a mesa em que EU estou: a presença de
                    // voz que carrega esse estado é a do canal conectado.
                    micOff={
                      voiceSession.active?.channelId === c.id &&
                      !!voiceSession.estadosDeAudio[userId]?.micOff
                    }
                  />
                </li>
              ))}
          </ul>
        )}
      </div>
    );
  };

  const renderBloco = (bloco: Bloco<Channel>, i: number) => {
    const k = bloco.categoria;
    if (!k) {
      // Mesas soltas: sem cabeçalho. Enquanto alguém arrasta uma mesa e não há
      // nenhuma solta, aparece uma faixa para ter onde soltar.
      if (bloco.mesas.length === 0) {
        if (arraste?.tipo !== "mesa") return null;
        const destino: Alvo = { tipo: "fim-da-categoria", id: null };
        return (
          <div
            key="soltas"
            {...zonaDeSoltura("mesa", destino)}
            className={cn(
              "text-muted-foreground mb-3 rounded-lg border border-dashed px-2 py-2 text-center text-[11px]",
              mesmoAlvo(alvo, destino) ? "border-primary" : "border-border",
            )}
          >
            Solta aqui para ficar sem categoria
          </div>
        );
      }
      return (
        <div key="soltas" className="mb-3">
          {bloco.mesas.map((c) => renderMesa(c, bloco))}
        </div>
      );
    }

    const recolhida = recolhidas.has(k.id);
    // Recolhida, a categoria ainda mostra a mesa aberta, para ninguém perder de
    // vista onde está.
    const visiveis = recolhida ? bloco.mesas.filter((c) => c.id === activeChannelId) : bloco.mesas;
    const ultima = i === blocos.length - 1;
    // Mesa solta no cabeçalho vai para o fim da categoria; categoria solta no
    // cabeçalho de outra toma o lugar dela.
    const destino: Alvo | null = !arraste
      ? null
      : arraste.tipo === "mesa"
        ? { tipo: "fim-da-categoria", id: k.id }
        : { tipo: "antes-da-categoria", id: k.id };

    return (
      <div key={k.id} className="mb-3">
        <div
          draggable={canManage}
          onDragStart={(e) => comecarArraste(e, { tipo: "categoria", id: k.id })}
          onDragEnd={terminarArraste}
          onDragOver={(e) => {
            if (!canManage || !destino) return;
            e.preventDefault();
            if (!mesmoAlvo(alvo, destino)) setAlvo(destino);
          }}
          onDrop={(e) => {
            if (!canManage || !destino) return;
            e.preventDefault();
            soltar(destino);
          }}
          className={cn(
            "group/categoria flex items-center gap-1 rounded-md border-t-2 border-transparent pr-1",
            mesmoAlvo(alvo, { tipo: "antes-da-categoria", id: k.id }) && "border-primary",
            mesmoAlvo(alvo, { tipo: "fim-da-categoria", id: k.id }) && "bg-primary/10",
            arraste?.id === k.id && "opacity-40",
          )}
        >
          <button
            onClick={() => alternarRecolhida(k.id)}
            className="text-muted-foreground hover:text-foreground flex min-w-0 flex-1 items-center gap-1 py-1 pl-0.5 text-left text-[11px] font-semibold tracking-[0.16em] uppercase"
          >
            <ChevronDown
              className={cn("size-3 shrink-0 transition-transform", recolhida && "-rotate-90")}
            />
            <span className="truncate">{k.name}</span>
          </button>
          {canManage && (
            <>
              <button
                title="Nova mesa nesta categoria"
                onClick={() => novaMesa(k.id)}
                className="text-muted-foreground hover:text-foreground hidden rounded p-0.5 group-hover/categoria:block"
              >
                <Plus className="size-3.5" />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    title="Ações da categoria"
                    className="text-muted-foreground hover:text-foreground hidden rounded p-0.5 group-hover/categoria:block data-[state=open]:block"
                  >
                    <MoreVertical className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onSelect={() => novaMesa(k.id)}>
                    <Plus className="size-4" /> Nova mesa aqui
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => setEditandoCategoria({ id: k.id, nome: k.name })}
                  >
                    <Pencil className="size-4" /> Renomear
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={i <= 1}
                    onSelect={() => organizar(deslocarCategoria(blocos, k.id, -1))}
                  >
                    <ArrowUp className="size-4" /> Subir
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={ultima}
                    onSelect={() => organizar(deslocarCategoria(blocos, k.id, 1))}
                  >
                    <ArrowDown className="size-4" /> Descer
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => setApagandoCategoria(k)}
                  >
                    <Trash2 className="size-4" /> Apagar categoria
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
        {visiveis.map((c) => renderMesa(c, bloco))}
        {!recolhida && bloco.mesas.length === 0 && (
          <p className="text-muted-foreground/70 px-2 py-1 text-xs">Nenhuma mesa</p>
        )}
      </div>
    );
  };

  return (
    <aside className="wood-texture border-border flex h-full w-64 shrink-0 flex-col border-r">
      <div className="border-border bg-rail flex h-14 items-center justify-between gap-2 border-b px-3">
        <Letreiro
          servers={servers}
          activeId={serverId}
          onSelect={onSelectServer}
          onCreate={onCreateServer}
          onJoin={onJoinServer}
        />
        <div className="ml-auto flex shrink-0 items-center gap-2.5">
          <button
            onClick={onOpenSalao}
            title="Ver o salão"
            className="text-muted-foreground hover:text-primary"
          >
            <LayoutGrid className="size-4" />
          </button>
          <button
            onClick={onOpenMembros}
            title="Quem senta aqui"
            className="text-muted-foreground hover:text-primary"
          >
            <Users className="size-4" />
          </button>
          {canManage && (
            <button
              onClick={onOpenSettings}
              title="Configurações do buteco"
              className="text-muted-foreground hover:text-primary"
            >
              <Settings className="size-4" />
            </button>
          )}
        </div>
      </div>

      {canManage && inviteCode && (
        <div className="border-border border-b p-2">
          <Button
            size="sm"
            className="w-full justify-center"
            onClick={() => setInviteOpen(true)}
            title="Copiar o link do convite"
          >
            <UserPlus className="size-4" /> Convidar a galera
          </Button>
        </div>
      )}

      <div className="scrollbar-thin flex-1 overflow-y-auto p-2">
        {blocos.map(renderBloco)}
        {/* Faixa para mandar uma categoria para o fim da lista. */}
        {arraste?.tipo === "categoria" && (
          <div
            {...zonaDeSoltura("categoria", { tipo: "antes-da-categoria", id: null })}
            className={cn(
              "text-muted-foreground mb-3 rounded-lg border border-dashed px-2 py-2 text-center text-[11px]",
              mesmoAlvo(alvo, { tipo: "antes-da-categoria", id: null })
                ? "border-primary"
                : "border-border",
            )}
          >
            Solta aqui para ir para o fim
          </div>
        )}
        {canManage && (
          <div className="flex flex-col">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => novaMesa(null)}
            >
              <Plus className="size-4" /> Nova mesa
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => setEditandoCategoria({ id: null, nome: "" })}
            >
              <FolderPlus className="size-4" /> Nova categoria
            </Button>
          </div>
        )}
      </div>

      <VoiceBar onOpenRoom={onOpenVoiceRoom} />

      <DockDeConversas />
      <MeuStatus onSignOut={onSignOut} isAdult={isAdult} />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-2xl tracking-wide">Nova mesa</DialogTitle>
            <DialogDescription>
              Pode ser uma mesa de texto pra resenha ou uma mesa de voz com tela compartilhada.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="channel-name">Nome da mesa</Label>
              <Input
                id="channel-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="mesa-do-valorant"
              />
              {name.trim() && (
                <p className="text-muted-foreground text-[11px]">
                  Vai aparecer como{" "}
                  <span className="text-primary font-medium">
                    {kind === "voice" ? "🔊" : "#"} {name.trim().toLowerCase().replace(/\s+/g, "-")}
                  </span>
                </p>
              )}
            </div>
            {categorias.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="channel-categoria">Categoria</Label>
                <select
                  id="channel-categoria"
                  value={categoriaDaNova}
                  onChange={(e) => setCategoriaDaNova(e.target.value)}
                  className="border-input bg-surface/60 focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
                >
                  <option value="">Sem categoria</option>
                  {[...categorias]
                    .sort((a, b) => a.position - b.position)
                    .map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.name}
                      </option>
                    ))}
                </select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Tipo</Label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { value: "text", icon: Hash, title: "Mesa de texto", hint: "Resenha escrita" },
                    { value: "voice", icon: Volume2, title: "Mesa de voz", hint: "Áudio e tela" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setKind(opt.value)}
                    className={cn(
                      "flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors",
                      kind === opt.value
                        ? "border-primary/70 bg-primary/10 glow-ring"
                        : "border-border bg-surface/60 hover:bg-surface-2",
                    )}
                  >
                    <opt.icon
                      className={cn(
                        "size-4",
                        kind === opt.value ? "text-primary" : "text-muted-foreground",
                      )}
                    />
                    <span className="text-sm font-medium">{opt.title}</span>
                    <span className="text-muted-foreground text-[11px]">{opt.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={saving || !name.trim()}>
              {saving ? "Botando a mesa..." : "Criar mesa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-2xl tracking-wide">Renomear mesa</DialogTitle>
            <DialogDescription>Como essa mesa passa a se chamar?</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rename-mesa">Nome da mesa</Label>
            <Input
              id="rename-mesa"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="mesa-do-valorant"
            />
          </div>
          <DialogFooter>
            <Button
              disabled={!renameValue.trim() || saving}
              onClick={async () => {
                if (!renaming) return;
                setSaving(true);
                await onRenameChannel(
                  renaming.id,
                  renameValue.trim().toLowerCase().replace(/\s+/g, "-"),
                );
                setSaving(false);
                setRenaming(null);
              }}
            >
              {saving ? "Salvando..." : "Renomear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl tracking-wide">
              Apagar a mesa {deleting?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.kind === "voice"
                ? "A mesa some para todo mundo e quem estiver nela é desconectado."
                : "A mesa some para todo mundo, junto com todas as conversas dela. Não dá para desfazer."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Deixa quieto</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!deleting) return;
                await onDeleteChannel(deleting.id);
                setDeleting(null);
              }}
            >
              Apagar mesa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!editandoCategoria} onOpenChange={(o) => !o && setEditandoCategoria(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-2xl tracking-wide">
              {editandoCategoria?.id ? "Renomear categoria" : "Nova categoria"}
            </DialogTitle>
            <DialogDescription>
              Categoria junta as mesas parecidas, tipo “Jogatina” ou “Papo sério”.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="categoria-nome">Nome da categoria</Label>
            <Input
              id="categoria-nome"
              value={editandoCategoria?.nome ?? ""}
              maxLength={40}
              onChange={(e) =>
                setEditandoCategoria((prev) => (prev ? { ...prev, nome: e.target.value } : prev))
              }
              placeholder="Jogatina"
            />
          </div>
          <DialogFooter>
            <Button
              disabled={!editandoCategoria?.nome.trim() || saving}
              onClick={async () => {
                if (!editandoCategoria) return;
                setSaving(true);
                const nome = editandoCategoria.nome.trim();
                if (editandoCategoria.id) await onRenomearCategoria(editandoCategoria.id, nome);
                else await onCriarCategoria(nome);
                setSaving(false);
                setEditandoCategoria(null);
              }}
            >
              {saving ? "Salvando..." : editandoCategoria?.id ? "Renomear" : "Criar categoria"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!apagandoCategoria}
        onOpenChange={(o) => !o && setApagandoCategoria(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl tracking-wide">
              Apagar a categoria {apagandoCategoria?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Só a categoria some. As mesas dela continuam no buteco, sem categoria, com as
              conversas intactas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Deixa quieto</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!apagandoCategoria) return;
                await onApagarCategoria(apagandoCategoria.id);
                setApagandoCategoria(null);
              }}
            >
              Apagar categoria
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {inviteCode && (
        <InviteDialog
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          serverName={serverName}
          inviteCode={inviteCode}
          serverId={serverId}
          canManage={canManage}
          onRegenerate={onRegenerateInvite}
        />
      )}
    </aside>
  );
}
