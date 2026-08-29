import { useState } from "react";
import { Hash, Volume2, Plus, Copy, LogOut, ShieldCheck, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
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
import { VoiceBar } from "@/components/app/VoiceBar";
import { useVoice } from "@/lib/voice";
import { useVoiceRoster } from "@/hooks/useVoiceRoster";
import { Settings, MoreVertical, Pencil, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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

export type Channel = { id: string; name: string; kind: string; server_id: string };

type Props = {
  serverName: string;
  inviteCode: string | null;
  channels: Channel[];
  activeChannelId: string | null;
  onSelect: (c: Channel) => void;
  isOwner: boolean;
  onCreateChannel: (name: string, kind: "text" | "voice") => Promise<void>;
  displayName: string;
  isAdult: boolean;
  onSignOut: () => void;
  onOpenVoiceRoom: (channelId: string) => void;
  serverId: string;
  names: Record<string, string>;
  canManage: boolean;
  onOpenSettings: () => void;
  onRenameChannel: (channelId: string, name: string) => Promise<void>;
  onDeleteChannel: (channelId: string) => Promise<void>;
};

export function ChannelSidebar({
  serverName,
  inviteCode,
  channels,
  activeChannelId,
  onSelect,
  isOwner,
  onCreateChannel,
  displayName,
  isAdult,
  onSignOut,
  onOpenVoiceRoom,
  serverId,
  names,
  canManage,
  onOpenSettings,
  onRenameChannel,
  onDeleteChannel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"text" | "voice">("text");
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState<Channel | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<Channel | null>(null);

  const text = channels.filter((c) => c.kind === "text");
  const voice = channels.filter((c) => c.kind === "voice");

  const voiceSession = useVoice();
  const roster = useVoiceRoster(
    serverId,
    voice.map((c) => c.id),
    voiceSession.active?.channelId ?? null,
  );

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await onCreateChannel(name.trim().toLowerCase().replace(/\s+/g, "-"), kind);
    setSaving(false);
    setName("");
    setOpen(false);
  };

  const renderGroup = (label: string, list: Channel[], Icon: typeof Hash) => (
    <div className="mb-4">
      <p className="text-muted-foreground mb-1 px-2 text-[11px] font-semibold tracking-[0.16em] uppercase">
        {label}
      </p>
      {list.map((c) => {
        const seated = roster[c.id] ?? [];
        return (
          <div key={c.id}>
            <ContextMenu>
              <ContextMenuTrigger disabled={!canManage} asChild>
                <div className="group/mesa relative">
                  <button
                    onClick={() => onSelect(c)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
                      activeChannelId === c.id
                        ? "bg-surface-2 text-primary"
                        : "text-muted-foreground hover:bg-surface-2/60 hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate">{c.name}</span>
                    {c.kind === "voice" && seated.length > 0 && (
                      <span
                        className={cn(
                          "text-muted-foreground ml-auto shrink-0 text-[10px] tabular-nums",
                          canManage && "group-hover/mesa:opacity-0",
                        )}
                      >
                        {seated.length}
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
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem
                          onSelect={() => {
                            setRenameValue(c.name);
                            setRenaming(c);
                          }}
                        >
                          <Pencil className="size-4" /> Renomear
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => setDeleting(c)}
                        >
                          <Trash2 className="size-4" /> Apagar mesa
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-40">
                <ContextMenuItem
                  onSelect={() => {
                    setRenameValue(c.name);
                    setRenaming(c);
                  }}
                >
                  <Pencil className="size-4" /> Renomear
                </ContextMenuItem>
                <ContextMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => setDeleting(c)}
                >
                  <Trash2 className="size-4" /> Apagar mesa
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>

            {/* quem está na mesa agora — visível pra todo mundo do buteco */}
            {c.kind === "voice" && seated.length > 0 && (
              <ul className="mt-0.5 mb-1 ml-4 flex flex-col gap-1 border-l border-border/60 pl-3">
                {seated
                  .map((userId) => ({ userId, name: names[userId] ?? "Participante" }))
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map(({ userId, name }) => (
                    <li key={userId} className="flex items-center gap-1.5">
                      <Bottlecap
                        name={name}
                        speaking={
                          voiceSession.active?.channelId === c.id && !!voiceSession.speaking[userId]
                        }
                        className="size-5 text-[10px]"
                      />
                      <span className="text-muted-foreground/80 truncate text-[11px]">{name}</span>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        );
      })}
      {list.length === 0 && <p className="text-muted-foreground px-2 py-1 text-xs">Nenhuma mesa</p>}
    </div>
  );

  return (
    <aside className="wood-texture border-border flex h-full w-60 shrink-0 flex-col border-r">
      <div className="border-border flex h-14 items-center justify-between gap-2 border-b px-4">
        <h2 className="font-display truncate text-lg tracking-wide">{serverName}</h2>
        {canManage && (
          <button
            onClick={onOpenSettings}
            title="Configurações do buteco"
            className="text-muted-foreground hover:text-primary ml-auto shrink-0"
          >
            <Settings className="size-4" />
          </button>
        )}
        {inviteCode && (
          <button
            onClick={() => {
              void navigator.clipboard.writeText(inviteCode);
              toast.success("Convite copiado: " + inviteCode);
            }}
            className="text-muted-foreground hover:text-primary shrink-0"
            title="Copiar convite"
          >
            <Copy className="size-4" />
          </button>
        )}
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto p-2">
        {renderGroup("Mesas de texto", text, Hash)}
        {renderGroup("Mesas de voz", voice, Volume2)}
        {canManage && (
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setOpen(true)}>
            <Plus className="size-4" /> Nova mesa
          </Button>
        )}
      </div>

      <VoiceBar onOpenRoom={onOpenVoiceRoom} />

      <div className="border-border bg-rail flex items-center gap-2 border-t px-3 py-2.5">
        <Bottlecap name={displayName} className="size-9" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{displayName}</p>
          <p
            className={cn(
              "flex items-center gap-1 text-[11px]",
              isAdult ? "text-primary" : "text-neon",
            )}
          >
            {isAdult ? <ShieldCheck className="size-3" /> : <ShieldAlert className="size-3" />}
            {isAdult ? "Tela liberada" : "Modo protegido"}
          </p>
        </div>
        <button onClick={onSignOut} className="text-muted-foreground hover:text-destructive" title="Sair">
          <LogOut className="size-4" />
        </button>
      </div>

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
    </aside>
  );
}
