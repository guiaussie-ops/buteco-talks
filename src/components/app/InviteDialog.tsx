import { useEffect, useState } from "react";
import { Check, Copy, Link2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverName: string;
  inviteCode: string;
  canManage: boolean;
  onRegenerate: () => Promise<void>;
};

/** Monta o link absoluto do convite. No SSR não há window, então cai no código puro. */
function inviteUrl(code: string) {
  if (typeof window === "undefined") return code;
  return `${window.location.origin}/convite/${code}`;
}

export function InviteDialog({
  open,
  onOpenChange,
  serverName,
  inviteCode,
  canManage,
  onRegenerate,
}: Props) {
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [spinning, setSpinning] = useState(false);

  const url = inviteUrl(inviteCode);

  // O "copiado" é só um respiro visual; some sozinho.
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  useEffect(() => {
    if (!open) setCopied(null);
  }, [open]);

  const copy = async (what: "link" | "code") => {
    const value = what === "link" ? url : inviteCode;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      toast.success(what === "link" ? "Link copiado. Cola no grupo!" : "Código copiado.");
    } catch {
      // Contexto sem permissão de clipboard (http em rede local, por exemplo).
      toast.error("Não consegui copiar. Selecione e copie na mão.");
    }
  };

  const regenerate = async () => {
    setSpinning(true);
    await onRegenerate();
    setSpinning(false);
    setConfirmOpen(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="wood-texture">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl tracking-wide">
              Convidar a galera
            </DialogTitle>
            <DialogDescription>
              Manda o link pra quem você quer sentado na mesa do {serverName}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="space-y-2">
              <Label>Link do convite</Label>
              <div className="border-border bg-surface-2 flex items-center gap-2 rounded-xl border p-2">
                <Link2 className="text-primary ml-1 size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate font-mono text-sm">{url}</span>
                <Button size="sm" onClick={() => void copy("link")} className="shrink-0">
                  {copied === "link" ? <Check className="size-4" /> : <Copy className="size-4" />}
                  {copied === "link" ? "Copiado" : "Copiar"}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Ou passe só o código</Label>
              <button
                type="button"
                onClick={() => void copy("code")}
                title="Copiar código"
                className={cn(
                  "border-border bg-surface-2 hover:border-primary/60 flex w-full items-center",
                  "justify-between gap-2 rounded-xl border p-3 transition-colors",
                )}
              >
                <span className="font-display text-primary text-2xl tracking-[0.25em]">
                  {inviteCode}
                </span>
                {copied === "code" ? (
                  <Check className="text-primary size-4 shrink-0" />
                ) : (
                  <Copy className="text-muted-foreground size-4 shrink-0" />
                )}
              </button>
              <p className="text-muted-foreground text-xs">
                Quem já tem conta cola isso em “Puxar uma cadeira”.
              </p>
            </div>

            {canManage && (
              <div className="border-border border-t pt-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Trocar o convite</p>
                    <p className="text-muted-foreground text-xs">
                      Gera um código novo. O antigo para de funcionar na hora — quem já está no
                      buteco continua dentro.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => setConfirmOpen(true)}
                    disabled={spinning}
                  >
                    <RefreshCw className={cn("size-4", spinning && "animate-spin")} />
                    Gerar novo
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="wood-texture">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl tracking-wide">
              Gerar um convite novo?
            </AlertDialogTitle>
            <AlertDialogDescription>
              O código <span className="text-primary font-mono">{inviteCode}</span> deixa de valer.
              Quem receber o link antigo não vai mais conseguir entrar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Deixa quieto</AlertDialogCancel>
            <AlertDialogAction onClick={() => void regenerate()} disabled={spinning}>
              {spinning ? "Gerando..." : "Gerar novo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
