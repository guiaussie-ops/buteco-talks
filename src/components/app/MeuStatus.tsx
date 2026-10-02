import { useState } from "react";
import {
  BellOff,
  BellRing,
  ChevronDown,
  LogOut,
  Music2,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useMediaPrefs } from "@/lib/mediaPrefs";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { usePerfil } from "@/lib/perfil";
import { ORDEM_DOS_STATUS, STATUS, statusDe, type Status } from "@/lib/status";
import { cn } from "@/lib/utils";
import { Bottlecap } from "@/components/Bottlecap";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * O "você" do rodapé, à moda do MSN: a tampinha abre o seu perfil, o status
 * escolhe "tomando uma / ocupado / saiu pra fumar / invisível", e o subnick
 * se edita ali mesmo, com um clique.
 */
export function MeuStatus({ onSignOut, isAdult }: { onSignOut: () => void; isAdult: boolean }) {
  const { profile, refreshProfile } = useAuth();
  const { abrirPerfil } = usePerfil();
  const { prefs, setPrefs } = useMediaPrefs();
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState("");
  if (!profile) return null;

  const nome = profile.display_name || profile.username;
  const status = statusDe(profile.status);

  const salvar = async (patch: { status?: Status; subnick?: string | null }) => {
    const { error } = await supabase.from("profiles").update(patch).eq("id", profile.id);
    if (error) {
      toast.error("Não consegui salvar.");
      return;
    }
    await refreshProfile();
  };

  return (
    <div className="border-border bg-rail flex flex-col gap-1 border-t px-3 py-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => abrirPerfil(profile.id)}
          title="Meu perfil"
          className="relative shrink-0 rounded-full"
        >
          <Bottlecap name={nome} src={profile.avatar_url} className="size-9" />
          <span
            className={cn(
              "border-rail absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2",
              STATUS[status].cor,
            )}
          />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span className="truncate text-sm font-medium">{nome}</span>
            <span
              title={
                isAdult
                  ? "Tela liberada"
                  : "Modo protegido: câmera e tela desativadas por ser menor de 18 anos"
              }
              className={cn("shrink-0", isAdult ? "text-primary" : "text-neon")}
            >
              {isAdult ? <ShieldCheck className="size-3" /> : <ShieldAlert className="size-3" />}
            </span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[11px]">
              {STATUS[status].rotulo}
              <ChevronDown className="size-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              {ORDEM_DOS_STATUS.map((s) => (
                <DropdownMenuItem key={s} onSelect={() => void salvar({ status: s })}>
                  <span className={cn("size-2.5 rounded-full", STATUS[s].cor)} />
                  {STATUS[s].rotulo}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setPrefs({ sons: !prefs.sons })}>
                {prefs.sons ? <BellOff className="size-4" /> : <BellRing className="size-4" />}
                {prefs.sons ? "Desligar os sons do bar" : "Ligar os sons do bar"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="text-muted-foreground hover:text-destructive"
          title="Sair"
        >
          <LogOut className="size-4" />
        </button>
      </div>

      {editando ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setEditando(false);
            const novo = rascunho.trim() || null;
            if (novo !== (profile.subnick ?? null)) void salvar({ subnick: novo });
          }}
        >
          <label htmlFor="subnick" className="sr-only">
            Mensagem pessoal
          </label>
          <input
            id="subnick"
            autoFocus
            value={rascunho}
            maxLength={120}
            onChange={(e) => setRascunho(e.target.value)}
            onBlur={(e) => e.currentTarget.form?.requestSubmit()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditando(false);
            }}
            placeholder="O que você está fazendo?"
            className="bg-surface border-border focus:border-primary/60 w-full rounded border px-2 py-1 text-xs italic outline-none"
          />
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            setRascunho(profile.subnick ?? "");
            setEditando(true);
          }}
          className="text-muted-foreground hover:text-foreground flex min-w-0 items-center gap-1.5 rounded px-0.5 text-left text-xs italic"
          title="Mudar a mensagem pessoal"
        >
          <Music2 className="size-3 shrink-0" />
          <span className="truncate">{profile.subnick || "<Digite uma mensagem pessoal>"}</span>
        </button>
      )}
    </div>
  );
}
