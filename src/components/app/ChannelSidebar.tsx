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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

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
}: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"text" | "voice">("text");
  const [saving, setSaving] = useState(false);

  const text = channels.filter((c) => c.kind === "text");
  const voice = channels.filter((c) => c.kind === "voice");

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
      <p className="text-muted-foreground mb-1 px-2 text-[11px] font-semibold tracking-wider uppercase">
        {label}
      </p>
      {list.map((c) => (
        <button
          key={c.id}
          onClick={() => onSelect(c)}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
            activeChannelId === c.id
              ? "bg-surface-2 text-foreground"
              : "text-muted-foreground hover:bg-surface hover:text-foreground",
          )}
        >
          <Icon className="size-4 shrink-0" />
          <span className="truncate">{c.name}</span>
        </button>
      ))}
      {list.length === 0 && <p className="text-muted-foreground px-2 py-1 text-xs">Nenhum canal</p>}
    </div>
  );

  return (
    <aside className="bg-surface flex h-full w-60 shrink-0 flex-col border-r border-border">
      <div className="border-border flex h-14 items-center justify-between gap-2 border-b px-4">
        <h2 className="truncate font-display text-sm font-semibold">{serverName}</h2>
        {inviteCode && (
          <button
            onClick={() => {
              void navigator.clipboard.writeText(inviteCode);
              toast.success("Código de convite copiado: " + inviteCode);
            }}
            className="text-muted-foreground hover:text-primary shrink-0"
            title="Copiar convite"
          >
            <Copy className="size-4" />
          </button>
        )}
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto p-2">
        {renderGroup("Canais de texto", text, Hash)}
        {renderGroup("Voz e tela", voice, Volume2)}
        {isOwner && (
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setOpen(true)}>
            <Plus className="size-4" /> Novo canal
          </Button>
        )}
      </div>

      <div className="border-border bg-rail flex items-center gap-2 border-t px-3 py-2.5">
        <Avatar className="size-8">
          <AvatarFallback className="bg-primary text-primary-foreground text-xs">
            {displayName.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{displayName}</p>
          <p
            className={cn(
              "flex items-center gap-1 text-[11px]",
              isAdult ? "text-primary" : "text-warning",
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
            <DialogTitle>Novo canal</DialogTitle>
            <DialogDescription>Crie um canal de texto ou uma sala de voz e tela.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="channel-name">Nome</Label>
              <Input
                id="channel-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="suporte"
              />
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as "text" | "voice")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Canal de texto</SelectItem>
                  <SelectItem value="voice">Sala de voz e tela</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={saving || !name.trim()}>
              {saving ? "Criando..." : "Criar canal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
