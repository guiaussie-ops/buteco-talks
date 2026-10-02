import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Crown,
  DoorOpen,
  Gavel,
  MoreVertical,
  Search,
  Shield,
  ShieldHalf,
  UserMinus,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Bottlecap } from "@/components/Bottlecap";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DESCRICAO,
  PESO,
  ROTULO,
  cargoDe,
  cargosQuePossoDar,
  possoBanir,
  possoExpulsar,
  type Cargo,
} from "@/lib/cargos";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverId: string;
  serverName: string;
  ownerId: string;
  userId: string;
  meuCargo: Cargo;
  names: Record<string, string>;
  avatars: Record<string, string | null>;
  usernames: Record<string, string>;
  roles: Record<string, string>;
  onSair: () => Promise<void>;
};

type Pessoa = { userId: string; name: string; username: string; cargo: Cargo };

const ICONE: Record<Cargo, typeof Crown | null> = {
  owner: Crown,
  admin: Shield,
  moderador: ShieldHalf,
  member: null,
};

function SeloDeCargo({ cargo }: { cargo: Cargo }) {
  const Icone = ICONE[cargo];
  if (!Icone) return null;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
        cargo === "owner" && "bg-primary/20 text-primary",
        cargo === "admin" && "bg-neon/15 text-neon",
        cargo === "moderador" && "bg-surface-2 text-foreground/80",
      )}
    >
      <Icone className="size-3" /> {ROTULO[cargo]}
    </span>
  );
}

/** Mensagem de erro do banco em português de buteco, sem expor o texto cru. */
function avisarErro(acao: string) {
  toast.error(`Não consegui ${acao}. Pode ser que você não tenha mais permissão.`);
}

export function MembrosDialog({
  open,
  onOpenChange,
  serverId,
  serverName,
  ownerId,
  userId,
  meuCargo,
  names,
  avatars,
  usernames,
  roles,
  onSair,
}: Props) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [expulsando, setExpulsando] = useState<Pessoa | null>(null);
  const [banindo, setBanindo] = useState<Pessoa | null>(null);
  const [motivo, setMotivo] = useState("");
  const [saindo, setSaindo] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const souAdmin = PESO[meuCargo] >= PESO.admin;

  const pessoas = useMemo<Pessoa[]>(() => {
    const termo = busca.trim().toLowerCase();
    return Object.keys(roles)
      .map((id) => ({
        userId: id,
        name: names[id] ?? "Alguém",
        username: usernames[id] ?? "",
        cargo: cargoDe(roles[id], id, ownerId),
      }))
      .filter(
        (p) =>
          !termo ||
          p.name.toLowerCase().includes(termo) ||
          p.username.toLowerCase().includes(termo),
      )
      .sort((a, b) => PESO[b.cargo] - PESO[a.cargo] || a.name.localeCompare(b.name));
  }, [roles, names, usernames, ownerId, busca]);

  const banidosQuery = useQuery({
    queryKey: ["banidos", serverId],
    enabled: open && souAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("banidos", { _server_id: serverId });
      if (error) throw error;
      return data ?? [];
    },
  });

  const recarregarMembros = () => qc.invalidateQueries({ queryKey: ["members", serverId] });

  const mudarCargo = async (p: Pessoa, cargo: Exclude<Cargo, "owner">) => {
    if (cargo === p.cargo) return;
    const { error } = await supabase.rpc("definir_cargo", {
      _server_id: serverId,
      _user_id: p.userId,
      _role: cargo,
    });
    if (error) return avisarErro("mudar o cargo");
    await recarregarMembros();
    toast.success(`${p.name} agora é ${ROTULO[cargo].toLowerCase()}.`);
  };

  const tirar = async (p: Pessoa, banir: boolean) => {
    setOcupado(true);
    const { error } = await supabase.rpc("expulsar", {
      _server_id: serverId,
      _user_id: p.userId,
      _banir: banir,
      ...(banir ? { _motivo: motivo } : {}),
    });
    setOcupado(false);
    setExpulsando(null);
    setBanindo(null);
    setMotivo("");
    if (error) return avisarErro(banir ? "banir" : "expulsar");
    await recarregarMembros();
    if (banir) await qc.invalidateQueries({ queryKey: ["banidos", serverId] });
    toast.success(banir ? `${p.name} foi banido.` : `${p.name} foi expulso.`);
  };

  const desbanir = async (id: string, nome: string) => {
    const { error } = await supabase.rpc("desbanir", { _server_id: serverId, _user_id: id });
    if (error) return avisarErro("desbanir");
    await qc.invalidateQueries({ queryKey: ["banidos", serverId] });
    toast.success(`${nome} pode voltar com um convite.`);
  };

  const lista = (
    <div className="space-y-3">
      <div className="relative">
        <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Procurar pelo nome ou @usuário"
          className="pl-9"
        />
      </div>
      <ul className="scrollbar-thin -mx-1 max-h-[50vh] space-y-0.5 overflow-y-auto px-1">
        {pessoas.map((p) => {
          const cargos = cargosQuePossoDar(meuCargo, p.cargo);
          const expulsa = possoExpulsar(meuCargo, p.cargo);
          const bane = possoBanir(meuCargo, p.cargo);
          const temAcoes = p.userId !== userId && (cargos.length > 0 || expulsa || bane);
          return (
            <li
              key={p.userId}
              className="hover:bg-surface-2/60 flex items-center gap-3 rounded-lg px-2 py-1.5"
            >
              <Bottlecap
                name={p.name}
                src={avatars[p.userId]}
                className="size-8 shrink-0 text-xs"
              />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{p.name}</span>
                  {p.userId === userId && (
                    <span className="text-muted-foreground text-[11px]">(você)</span>
                  )}
                </p>
                <p className="text-muted-foreground truncate text-xs">@{p.username}</p>
              </div>
              <SeloDeCargo cargo={p.cargo} />
              {temAcoes ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      title={`Ações para ${p.name}`}
                      className="text-muted-foreground hover:text-foreground hover:bg-surface-2 rounded p-1"
                    >
                      <MoreVertical className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    {cargos.length > 0 && (
                      <>
                        <DropdownMenuLabel className="text-muted-foreground text-xs">
                          Cargo
                        </DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                          value={p.cargo}
                          onValueChange={(v) => void mudarCargo(p, v as Exclude<Cargo, "owner">)}
                        >
                          {cargos.map((c) => (
                            <DropdownMenuRadioItem key={c} value={c} className="items-start">
                              <span className="flex flex-col">
                                <span>{ROTULO[c]}</span>
                                <span className="text-muted-foreground text-[11px] leading-snug">
                                  {DESCRICAO[c]}
                                </span>
                              </span>
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </>
                    )}
                    {cargos.length > 0 && (expulsa || bane) && <DropdownMenuSeparator />}
                    {expulsa && (
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => setExpulsando(p)}
                      >
                        <UserMinus className="size-4" /> Expulsar
                      </DropdownMenuItem>
                    )}
                    {bane && (
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => setBanindo(p)}
                      >
                        <Gavel className="size-4" /> Banir
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <span className="w-6" />
              )}
            </li>
          );
        })}
        {pessoas.length === 0 && (
          <li className="text-muted-foreground py-6 text-center text-sm">Ninguém com esse nome.</li>
        )}
      </ul>
    </div>
  );

  const banidos = banidosQuery.data ?? [];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="wood-texture">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl tracking-wide">
              Quem senta aqui
            </DialogTitle>
            <DialogDescription>
              {Object.keys(roles).length} {Object.keys(roles).length === 1 ? "pessoa" : "pessoas"}{" "}
              no {serverName}.
            </DialogDescription>
          </DialogHeader>

          {souAdmin ? (
            <Tabs defaultValue="membros">
              <TabsList className="mb-3">
                <TabsTrigger value="membros">Membros</TabsTrigger>
                <TabsTrigger value="banidos">
                  Banidos{banidos.length > 0 ? ` (${banidos.length})` : ""}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="membros">{lista}</TabsContent>
              <TabsContent value="banidos">
                <ul className="scrollbar-thin max-h-[50vh] space-y-0.5 overflow-y-auto">
                  {banidos.map((b) => {
                    const nome = b.display_name || b.username || "Conta apagada";
                    return (
                      <li
                        key={b.user_id}
                        className="flex items-center gap-3 rounded-lg px-2 py-1.5"
                      >
                        <Bottlecap
                          name={nome}
                          src={b.avatar_url}
                          className="size-8 shrink-0 text-xs"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{nome}</p>
                          <p className="text-muted-foreground truncate text-xs">
                            {b.reason ? `Motivo: ${b.reason}` : "Sem motivo anotado"} ·{" "}
                            {new Date(b.created_at).toLocaleDateString("pt-BR")}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void desbanir(b.user_id, nome)}
                        >
                          Desbanir
                        </Button>
                      </li>
                    );
                  })}
                  {banidos.length === 0 && (
                    <li className="text-muted-foreground py-6 text-center text-sm">
                      Ninguém banido. Buteco tranquilo.
                    </li>
                  )}
                </ul>
              </TabsContent>
            </Tabs>
          ) : (
            lista
          )}

          {meuCargo !== "owner" && (
            <DialogFooter className="border-border border-t pt-4 sm:justify-start">
              <Button
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setSaindo(true)}
              >
                <DoorOpen className="size-4" /> Sair do buteco
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!expulsando} onOpenChange={(o) => !o && setExpulsando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl tracking-wide">
              Expulsar {expulsando?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Sai do buteco e da mesa de voz na hora. Pode voltar se receber um convite — para não
              deixar voltar, use Banir.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Deixa quieto</AlertDialogCancel>
            <AlertDialogAction
              disabled={ocupado}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => expulsando && void tirar(expulsando, false)}
            >
              Expulsar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!banindo}
        onOpenChange={(o) => {
          if (!o) {
            setBanindo(null);
            setMotivo("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl tracking-wide">
              Banir {banindo?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Sai do buteco agora e nenhum convite deixa entrar de novo, até alguém desbanir na aba
              Banidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="motivo-ban">Motivo (só a gestão vê)</Label>
            <Textarea
              id="motivo-ban"
              value={motivo}
              maxLength={300}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Opcional"
              className="min-h-16 resize-none"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Deixa quieto</AlertDialogCancel>
            <AlertDialogAction
              disabled={ocupado}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => banindo && void tirar(banindo, true)}
            >
              Banir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={saindo} onOpenChange={setSaindo}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl tracking-wide">
              Sair do {serverName}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Para voltar, você vai precisar de um convite novo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Ficar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setSaindo(false);
                void onSair();
              }}
            >
              Sair
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
