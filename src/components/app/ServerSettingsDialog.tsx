import { useEffect, useState } from "react";
import { Trash2, Save } from "lucide-react";
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
import { cn } from "@/lib/utils";

/** Ícones com cara de buteco. */
const EMOJIS = ["🍺", "🍻", "🥃", "🍿", "🎲", "🎮", "🎸", "⚽", "🔥", "🌵", "🃏", "🎯", "🍔", "🎤"];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverName: string;
  iconEmoji: string;
  isOwner: boolean;
  onSave: (name: string, iconEmoji: string) => Promise<void>;
  onDelete: () => Promise<void>;
};

export function ServerSettingsDialog({
  open,
  onOpenChange,
  serverName,
  iconEmoji,
  isOwner,
  onSave,
  onDelete,
}: Props) {
  const [name, setName] = useState(serverName);
  const [emoji, setEmoji] = useState(iconEmoji);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  // Reabrir o painel volta aos valores atuais do buteco.
  useEffect(() => {
    if (open) {
      setName(serverName);
      setEmoji(iconEmoji);
      setConfirmText("");
    }
  }, [open, serverName, iconEmoji]);

  const dirty = name.trim() !== serverName || emoji !== iconEmoji;

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await onSave(name.trim(), emoji);
    setSaving(false);
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="wood-texture">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl tracking-wide">
              Configurações do buteco
            </DialogTitle>
            <DialogDescription>Ajeite o nome e a placa da porta.</DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="buteco-name">Nome do buteco</Label>
              <div className="flex items-center gap-3">
                <span className="bg-gradient-amber text-primary-foreground glow-ring flex size-12 shrink-0 items-center justify-center rounded-2xl text-2xl">
                  {emoji || name.slice(0, 1).toUpperCase()}
                </span>
                <Input
                  id="buteco-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Buteco do Zé"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Placa da porta</Label>
              <div className="border-border bg-surface/60 grid grid-cols-7 gap-1.5 rounded-xl border p-2">
                {EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setEmoji(e)}
                    className={cn(
                      "flex aspect-square items-center justify-center rounded-lg text-xl transition-colors",
                      emoji === e ? "bg-primary/25 ring-primary/70 ring-2" : "hover:bg-surface-2",
                    )}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter className="sm:justify-between">
            {isOwner ? (
              <Button
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setConfirmOpen(true)}
              >
                <Trash2 className="size-4" /> Fechar o buteco
              </Button>
            ) : (
              <span />
            )}
            <Button onClick={() => void save()} disabled={!dirty || !name.trim() || saving}>
              <Save className="size-4" /> {saving ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl tracking-wide">
              Fechar o buteco de vez?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Isso apaga <strong>{serverName}</strong> para todo mundo: todas as mesas, todas as
              conversas e a lista de quem participa. Não dá para desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor="confirm-name">
              Para confirmar, digite o nome do buteco:{" "}
              <span className="text-primary font-medium">{serverName}</span>
            </Label>
            <Input
              id="confirm-name"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={serverName}
              autoComplete="off"
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Deixa quieto</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmText.trim() !== serverName}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void onDelete()}
            >
              Fechar o buteco
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
