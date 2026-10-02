import { Link } from "@tanstack/react-router";
import { Check, ChevronDown, Home, LogIn, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ServerItem = { id: string; name: string; icon_emoji: string; owner_id: string };

/**
 * O letreiro de neon na porta do buteco. É também onde se troca de buteco:
 * substitui a coluna de ícones redondos, que era o traço mais "Discord" do app.
 */
export function Letreiro({
  servers,
  activeId,
  onSelect,
  onCreate,
  onJoin,
}: {
  servers: ServerItem[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onJoin: () => void;
}) {
  const atual = servers.find((s) => s.id === activeId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="group flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left"
          title="Trocar de buteco"
        >
          <span className="neon-sign font-display truncate text-2xl leading-none tracking-wider">
            {atual?.name ?? "Buteco"}
          </span>
          <ChevronDown className="text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-colors" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-muted-foreground text-xs">
          Meus butecos
        </DropdownMenuLabel>
        {servers.map((s) => (
          <DropdownMenuItem key={s.id} onSelect={() => onSelect(s.id)} className="gap-2.5">
            <span className="bg-surface-2 font-display flex size-7 shrink-0 items-center justify-center rounded-lg text-base">
              {s.icon_emoji || s.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate">{s.name}</span>
            {s.id === activeId && <Check className="text-primary size-4" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onCreate}>
          <Plus className="size-4" /> Abrir um buteco
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onJoin}>
          <LogIn className="size-4" /> Entrar com convite
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/">
            <Home className="size-4" /> Página inicial
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
