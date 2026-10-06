import { useMemo } from "react";
import { MessageCircle, PanelRightClose, Settings2, UserRound, Volume2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { usePerfil } from "@/lib/perfil";
import { useConversas } from "@/lib/conversas";
import { STATUS, type Status } from "@/lib/status";
import { PESO, cargoDe, type Cargo } from "@/lib/cargos";
import { cn } from "@/lib/utils";
import { Bottlecap } from "@/components/Bottlecap";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Pessoa = {
  userId: string;
  nome: string;
  cargo: Cargo;
  status: Status | null;
  subnick: string | null;
  mesaDeVoz: string | null;
};

/** Grupos de quem está online, na ordem em que aparecem. */
const GRUPOS_ONLINE: { cargo: Cargo; titulo: string }[] = [
  { cargo: "owner", titulo: "Dono" },
  { cargo: "admin", titulo: "Admins" },
  { cargo: "moderador", titulo: "Moderadores" },
  { cargo: "member", titulo: "No bar" },
];

function Linha({ p, avatar }: { p: Pessoa; avatar: string | null | undefined }) {
  const { abrirPerfil } = usePerfil();
  const { abrirConversa } = useConversas();
  const { session } = useAuth();
  const souEu = session?.user.id === p.userId;
  const online = p.status !== null;
  return (
    <li>
      {/* O clique pergunta o que fazer: ver o perfil ou chamar no privado. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          title={p.nome}
          className={cn(
            "hover:bg-surface-2/70 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors",
            !online && "opacity-50 hover:opacity-90",
          )}
        >
          <span className="relative shrink-0">
            <Bottlecap name={p.nome} src={avatar} className="size-8 text-xs" />
            {online && (
              <span
                className={cn(
                  "border-rail absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2",
                  STATUS[p.status!].cor,
                )}
              />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block truncate text-sm",
                p.cargo === "owner" ? "text-primary font-semibold" : "font-medium",
              )}
            >
              {p.nome}
            </span>
            {p.mesaDeVoz ? (
              <span className="text-muted-foreground flex items-center gap-1 truncate text-[11px]">
                <Volume2 className="size-3 shrink-0" />
                <span className="truncate">{p.mesaDeVoz}</span>
              </span>
            ) : (
              p.subnick && (
                <span className="text-muted-foreground block truncate text-[11px] italic">
                  {p.subnick}
                </span>
              )
            )}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="left" align="start" className="w-48">
          <DropdownMenuItem onSelect={() => abrirPerfil(p.userId)}>
            <UserRound className="size-4" /> Ver perfil
          </DropdownMenuItem>
          {!souEu && (
            <DropdownMenuItem onSelect={() => abrirConversa(p.userId)}>
              <MessageCircle className="size-4" /> Mandar mensagem
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/**
 * Quem frequenta o buteco, à direita, como a lista de membros do Discord
 * vestida de MSN: primeiro quem está no bar agora, por cargo, com a bolinha de
 * status e o subnick (ou a mesa de voz em que está sentado); depois quem está
 * fora, mais apagado. Clicar abre o perfil.
 */
export function Participantes({
  ownerId,
  roles,
  names,
  avatars,
  subnicks,
  online,
  roster,
  nomesDasMesas,
  podeGerenciar,
  onGerenciar,
  onEsconder,
}: {
  ownerId: string;
  roles: Record<string, string>;
  names: Record<string, string>;
  avatars: Record<string, string | null>;
  subnicks: Record<string, string | null>;
  online: Record<string, Status>;
  /** Quem está sentado em cada mesa de voz. */
  roster: Record<string, string[]>;
  nomesDasMesas: Record<string, string>;
  podeGerenciar: boolean;
  onGerenciar: () => void;
  /** Ausente no celular, onde a coluna é uma gaveta e não se esconde. */
  onEsconder?: (() => void) | undefined;
}) {
  const pessoas = useMemo<Pessoa[]>(() => {
    const ondeSentou: Record<string, string> = {};
    for (const [mesa, ids] of Object.entries(roster)) {
      ids.forEach((id) => (ondeSentou[id] = nomesDasMesas[mesa] ?? "mesa de voz"));
    }
    return Object.keys(roles)
      .map((id) => ({
        userId: id,
        nome: names[id] ?? "Alguém",
        cargo: cargoDe(roles[id], id, ownerId),
        status: online[id] ?? null,
        subnick: subnicks[id] ?? null,
        mesaDeVoz: ondeSentou[id] ?? null,
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [roles, names, ownerId, online, subnicks, roster, nomesDasMesas]);

  const noBar = pessoas.filter((p) => p.status !== null);
  const fora = pessoas.filter((p) => p.status === null);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="border-border flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <h2 className="font-display text-xl tracking-wide">Quem tá no bar</h2>
        <span className="text-muted-foreground text-xs tabular-nums">
          {noBar.length}/{pessoas.length}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {podeGerenciar && (
            <button
              type="button"
              onClick={onGerenciar}
              title="Gerenciar membros"
              aria-label="Gerenciar membros"
              className="text-muted-foreground hover:text-foreground hover:bg-surface-2 rounded p-1"
            >
              <Settings2 className="size-4" />
            </button>
          )}
          {onEsconder && (
            <button
              type="button"
              onClick={onEsconder}
              title="Esconder a lista"
              aria-label="Esconder a lista de quem tá no bar"
              className="text-muted-foreground hover:text-foreground hover:bg-surface-2 rounded p-1"
            >
              <PanelRightClose className="size-4" />
            </button>
          )}
        </div>
      </header>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-2 py-3">
        {GRUPOS_ONLINE.map(({ cargo, titulo }) => {
          const grupo = noBar.filter((p) => p.cargo === cargo);
          if (grupo.length === 0) return null;
          return (
            <div key={cargo} className="mb-4">
              <h3 className="text-muted-foreground mb-1 px-2 text-[11px] font-semibold tracking-[0.14em] uppercase">
                {titulo} — {grupo.length}
              </h3>
              <ul className="flex flex-col">
                {grupo.map((p) => (
                  <Linha key={p.userId} p={p} avatar={avatars[p.userId]} />
                ))}
              </ul>
            </div>
          );
        })}

        {fora.length > 0 && (
          <div className="mb-2">
            <h3 className="text-muted-foreground mb-1 px-2 text-[11px] font-semibold tracking-[0.14em] uppercase">
              Grampeado — {fora.length}
            </h3>
            <ul className="flex flex-col">
              {fora
                .slice()
                .sort((a, b) => PESO[b.cargo] - PESO[a.cargo] || a.nome.localeCompare(b.nome))
                .map((p) => (
                  <Linha key={p.userId} p={p} avatar={avatars[p.userId]} />
                ))}
            </ul>
          </div>
        )}

        {noBar.length === 0 && fora.length === 0 && (
          <p className="text-muted-foreground px-2 text-sm">Ninguém por aqui ainda.</p>
        )}
      </div>
    </section>
  );
}
