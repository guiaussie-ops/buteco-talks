import { Plus, LogIn, Home } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type ServerItem = { id: string; name: string; icon_emoji: string; owner_id: string };

type Props = {
  servers: ServerItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onJoin: () => void;
};

export function ServerRail({ servers, activeId, onSelect, onCreate, onJoin }: Props) {
  return (
    <TooltipProvider delayDuration={200}>
      <nav className="bg-rail flex h-full w-[68px] shrink-0 flex-col items-center gap-2 border-r border-border py-3">
        <Link
          to="/"
          className="bg-gradient-neon mb-1 flex size-11 items-center justify-center rounded-2xl text-lg font-bold text-primary-foreground"
        >
          <Home className="size-5" />
        </Link>
        <div className="bg-border h-px w-8" />

        <div className="scrollbar-thin flex w-full flex-1 flex-col items-center gap-2 overflow-y-auto">
          {servers.map((s) => (
            <Tooltip key={s.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onSelect(s.id)}
                  className={cn(
                    "flex size-11 items-center justify-center rounded-2xl text-lg transition-all",
                    activeId === s.id
                      ? "bg-primary text-primary-foreground rounded-xl"
                      : "bg-surface text-foreground hover:bg-surface-2 hover:rounded-xl",
                  )}
                >
                  {s.icon_emoji || s.name.slice(0, 1).toUpperCase()}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{s.name}</TooltipContent>
            </Tooltip>
          ))}
        </div>

        <div className="bg-border h-px w-8" />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onCreate}
              className="bg-surface text-primary hover:bg-primary hover:text-primary-foreground flex size-11 items-center justify-center rounded-2xl transition-all hover:rounded-xl"
            >
              <Plus className="size-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Criar comunidade</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onJoin}
              className="bg-surface text-muted-foreground hover:bg-surface-2 hover:text-foreground flex size-11 items-center justify-center rounded-2xl transition-all hover:rounded-xl"
            >
              <LogIn className="size-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Entrar com convite</TooltipContent>
        </Tooltip>
      </nav>
    </TooltipProvider>
  );
}
