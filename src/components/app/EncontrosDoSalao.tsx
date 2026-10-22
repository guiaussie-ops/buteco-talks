import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowRight,
  CalendarClock,
  CalendarPlus,
  Check,
  MoreVertical,
  Pencil,
  Save,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  DURA_MS,
  doCampoLocal,
  emPauta,
  horarioSugerido,
  paraCampoLocal,
  quandoE,
  quemVai,
  type Encontro,
} from "@/lib/encontros";
import { cn } from "@/lib/utils";
import type { Channel } from "@/components/app/ChannelSidebar";
import { MiniMesa } from "@/components/app/Mesas";
import { Bottlecap } from "@/components/Bottlecap";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Props = {
  serverId: string;
  meuId: string;
  /** Dono e admins marcam, mudam e cancelam. */
  podeMarcar: boolean;
  channels: Channel[];
  names: Record<string, string>;
  avatars: Record<string, string | null>;
  onIrPraMesa: (c: Channel) => void;
};

/** null = fechado; "novo" = marcando; um encontro = mudando aquele. */
type Formulario = null | "novo" | Encontro;

/**
 * O próximo encontro em destaque no salão: quando é, em que mesa, quem vai,
 * e o botão para sentar. Os outros que estão marcados ficam na agenda.
 * Quem está no salão vê tudo mudar na hora (useButecoAoVivo recarrega).
 */
export function EncontrosDoSalao({
  serverId,
  meuId,
  podeMarcar,
  channels,
  names,
  avatars,
  onIrPraMesa,
}: Props) {
  const qc = useQueryClient();
  const [agora, setAgora] = useState(() => new Date());
  const [agendaAberta, setAgendaAberta] = useState(false);
  const [formulario, setFormulario] = useState<Formulario>(null);
  const [cancelando, setCancelando] = useState<Encontro | null>(null);

  // "começa em 12 min" precisa andar sozinho, e o encontro que acabou sair.
  useEffect(() => {
    const t = window.setInterval(() => setAgora(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const query = useQuery({
    queryKey: ["encontros", serverId],
    queryFn: async (): Promise<Encontro[]> => {
      const { data, error } = await supabase
        .from("encontros")
        .select(
          "id, titulo, descricao, comeca_em, mesa_id, criado_por, presencas:presencas_em_encontros(user_id, vou)",
        )
        .eq("server_id", serverId)
        .is("cancelado_em", null)
        .gte("comeca_em", new Date(Date.now() - DURA_MS).toISOString())
        .order("comeca_em", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const pauta = useMemo(() => emPauta(query.data ?? [], agora), [query.data, agora]);
  const mesas = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);

  const recarregar = () => qc.invalidateQueries({ queryKey: ["encontros", serverId] });

  const marcarPresenca = async (e: Encontro, vou: boolean) => {
    const { error } = await supabase.rpc("confirmar_presenca", { _encontro_id: e.id, _vou: vou });
    if (error) {
      toast.error("Não consegui marcar sua presença.");
      return;
    }
    await recarregar();
    if (vou) toast.success(`Combinado! Te esperamos em "${e.titulo}".`);
  };

  const cancelar = async (e: Encontro) => {
    const { error } = await supabase.rpc("cancelar_encontro", { _id: e.id });
    setCancelando(null);
    if (error) {
      toast.error("Não consegui cancelar o encontro.");
      return;
    }
    await recarregar();
    await qc.invalidateQueries({ queryKey: ["historico", serverId] });
    toast.success("Encontro cancelado.");
  };

  if (!query.isSuccess) return null;
  const proximo = pauta[0];

  const acoes = (e: Encontro) => ({
    vou: quemVai(e.presencas).includes(meuId),
    onVou: (v: boolean) => void marcarPresenca(e, v),
    onMudar: () => setFormulario(e),
    onCancelar: () => setCancelando(e),
  });

  return (
    <>
      {proximo ? (
        <CartaoDoEncontro
          encontro={proximo}
          agora={agora}
          mesa={proximo.mesa_id ? mesas.get(proximo.mesa_id) : undefined}
          names={names}
          avatars={avatars}
          podeMarcar={podeMarcar}
          onIrPraMesa={onIrPraMesa}
          {...acoes(proximo)}
          rodape={
            (pauta.length > 1 || podeMarcar) && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                {pauta.length > 1 && (
                  <button
                    onClick={() => setAgendaAberta(true)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Ver a agenda ({pauta.length} marcados)
                  </button>
                )}
                {podeMarcar && (
                  <button
                    onClick={() => setFormulario("novo")}
                    className="text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    <CalendarPlus className="size-3.5" /> Marcar outro
                  </button>
                )}
              </div>
            )
          }
        />
      ) : (
        podeMarcar && (
          <button
            onClick={() => setFormulario("novo")}
            title="Hora marcada numa mesa: aparece aqui pra todo mundo confirmar."
            className="border-papel-linha/30 text-muted-foreground hover:border-primary/60 hover:text-foreground inline-flex h-8 items-center gap-1.5 rounded-full border border-dashed bg-black/30 px-3 text-xs font-medium transition-colors"
          >
            <CalendarPlus className="size-3.5" /> Marcar um encontro
          </button>
        )
      )}

      <Dialog open={agendaAberta} onOpenChange={setAgendaAberta}>
        <DialogContent className="wood-texture scrollbar-thin max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl tracking-wide">
              Agenda do buteco
            </DialogTitle>
            <DialogDescription>
              Os encontros marcados, do mais perto ao mais longe.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2">
            {pauta.map((e) => (
              <li key={e.id}>
                <LinhaDaAgenda
                  encontro={e}
                  agora={agora}
                  mesa={e.mesa_id ? mesas.get(e.mesa_id) : undefined}
                  podeMarcar={podeMarcar}
                  onIrPraMesa={(c) => {
                    setAgendaAberta(false);
                    onIrPraMesa(c);
                  }}
                  {...acoes(e)}
                />
              </li>
            ))}
          </ul>
          {podeMarcar && (
            <DialogFooter>
              <Button variant="outline" onClick={() => setFormulario("novo")}>
                <CalendarPlus className="size-4" /> Marcar encontro
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {podeMarcar && (
        <FormularioDoEncontro
          aberto={formulario !== null}
          encontro={formulario === "novo" ? null : formulario}
          serverId={serverId}
          channels={channels}
          onFechar={() => setFormulario(null)}
        />
      )}

      <AlertDialog open={!!cancelando} onOpenChange={(o) => !o && setCancelando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl tracking-wide">
              Cancelar "{cancelando?.titulo}"?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Some do salão para todo mundo, inclusive para quem já confirmou.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Deixa marcado</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => cancelando && void cancelar(cancelando)}
            >
              Cancelar encontro
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

type AcoesDoEncontro = {
  vou: boolean;
  onVou: (vou: boolean) => void;
  onMudar: () => void;
  onCancelar: () => void;
};

function CartaoDoEncontro({
  encontro,
  agora,
  mesa,
  names,
  avatars,
  podeMarcar,
  onIrPraMesa,
  vou,
  onVou,
  onMudar,
  onCancelar,
  rodape,
}: {
  encontro: Encontro;
  agora: Date;
  mesa: Channel | undefined;
  names: Record<string, string>;
  avatars: Record<string, string | null>;
  podeMarcar: boolean;
  onIrPraMesa: (c: Channel) => void;
  rodape: React.ReactNode;
} & AcoesDoEncontro) {
  const quando = quandoE(encontro.comeca_em, agora);
  const vao = quemVai(encontro.presencas);
  const destaque = quando.jaComecou || quando.logo;

  return (
    <article
      className={cn(
        "bg-rail/90 w-full max-w-2xl rounded-xl border px-5 py-4 shadow-[0_10px_24px_rgb(0_0_0/0.35)]",
        destaque ? "border-primary/70" : "border-border",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl",
            destaque ? "bg-gradient-amber text-primary-foreground glow-ring" : "bg-surface-2",
          )}
        >
          <CalendarClock className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-xs font-medium",
              quando.jaComecou ? "text-neon" : destaque ? "text-primary" : "text-muted-foreground",
            )}
          >
            {quando.jaComecou ? "● Acontecendo agora" : `Próximo encontro · ${quando.rotulo}`}
          </p>
          <h2 className="font-display truncate text-2xl leading-tight tracking-wide">
            {encontro.titulo}
          </h2>
          {encontro.descricao && (
            <p className="text-muted-foreground mt-0.5 text-sm whitespace-pre-line">
              {encontro.descricao}
            </p>
          )}
        </div>
        {podeMarcar && <MenuDoEncontro onMudar={onMudar} onCancelar={onCancelar} />}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-muted-foreground flex items-center gap-2 text-sm">
          {mesa ? (
            <>
              <MiniMesa tipo={mesa.kind === "voice" ? "voice" : "text"} className="scale-75" />
              <span className="text-foreground truncate">{mesa.name}</span>
            </>
          ) : (
            "Mesa ainda não escolhida"
          )}
        </span>
        <QuemVai ids={vao} names={names} avatars={avatars} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={vou ? "secondary" : destaque && !mesa ? "default" : "outline"}
          onClick={() => onVou(!vou)}
          aria-pressed={vou}
        >
          <Check className="size-4" /> {vou ? "Vou (desmarcar)" : "Vou!"}
        </Button>
        {mesa && (
          <Button
            size="sm"
            variant={destaque ? "default" : "outline"}
            onClick={() => onIrPraMesa(mesa)}
          >
            Ir pra mesa <ArrowRight className="size-4" />
          </Button>
        )}
      </div>

      {rodape && <div className="border-border mt-3 border-t pt-2.5">{rodape}</div>}
    </article>
  );
}

function LinhaDaAgenda({
  encontro,
  agora,
  mesa,
  podeMarcar,
  onIrPraMesa,
  vou,
  onVou,
  onMudar,
  onCancelar,
}: {
  encontro: Encontro;
  agora: Date;
  mesa: Channel | undefined;
  podeMarcar: boolean;
  onIrPraMesa: (c: Channel) => void;
} & AcoesDoEncontro) {
  const quando = quandoE(encontro.comeca_em, agora);
  const vao = quemVai(encontro.presencas).length;
  return (
    <div className="border-border bg-surface-2/50 rounded-lg border px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className={cn("text-xs", quando.jaComecou ? "text-neon" : "text-muted-foreground")}>
            {quando.rotulo}
          </p>
          <p className="truncate font-medium">{encontro.titulo}</p>
          <p className="text-muted-foreground truncate text-xs">
            {mesa ? mesa.name : "sem mesa"} · {vao} {vao === 1 ? "vai" : "vão"}
          </p>
        </div>
        {podeMarcar && <MenuDoEncontro onMudar={onMudar} onCancelar={onCancelar} />}
      </div>
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant={vou ? "secondary" : "outline"} onClick={() => onVou(!vou)}>
          <Check className="size-4" /> {vou ? "Vou" : "Vou!"}
        </Button>
        {mesa && (
          <Button size="sm" variant="ghost" onClick={() => onIrPraMesa(mesa)}>
            Ir pra mesa <ArrowRight className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

function MenuDoEncontro({ onMudar, onCancelar }: { onMudar: () => void; onCancelar: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          title="Mudar ou cancelar"
          className="text-muted-foreground hover:text-foreground hover:bg-surface-2 -mr-1 rounded p-1"
        >
          <MoreVertical className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onMudar}>
          <Pencil className="size-4" /> Mudar
        </DropdownMenuItem>
        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onCancelar}>
          <XCircle className="size-4" /> Cancelar encontro
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** As tampinhas de quem confirmou, até seis, e o total. */
function QuemVai({
  ids,
  names,
  avatars,
}: {
  ids: string[];
  names: Record<string, string>;
  avatars: Record<string, string | null>;
}) {
  if (ids.length === 0) {
    return <span className="text-muted-foreground text-sm">Ninguém confirmou ainda</span>;
  }
  const nomes = ids.map((id) => names[id] ?? "Alguém");
  return (
    <span className="flex items-center gap-2" title={nomes.join(", ")}>
      <span className="flex -space-x-2">
        {ids.slice(0, 6).map((id, i) => (
          <Bottlecap
            key={id}
            name={nomes[i]!}
            src={avatars[id]}
            className="ring-rail size-6 text-[9px] ring-2"
          />
        ))}
      </span>
      <span className="text-muted-foreground text-sm">
        {ids.length} {ids.length === 1 ? "vai" : "vão"}
      </span>
    </span>
  );
}

const seletor =
  "border-input bg-surface/60 focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none";

function FormularioDoEncontro({
  aberto,
  encontro,
  serverId,
  channels,
  onFechar,
}: {
  aberto: boolean;
  /** null = encontro novo. */
  encontro: Encontro | null;
  serverId: string;
  channels: Channel[];
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [quando, setQuando] = useState("");
  const [mesaId, setMesaId] = useState("");
  const [salvando, setSalvando] = useState(false);

  // Abrir o formulário traz o encontro como está, ou uma sugestão para um novo.
  useEffect(() => {
    if (!aberto) return;
    setTitulo(encontro?.titulo ?? "");
    setDescricao(encontro?.descricao ?? "");
    setQuando(paraCampoLocal(encontro ? new Date(encontro.comeca_em) : horarioSugerido()));
    setMesaId(
      encontro ? (encontro.mesa_id ?? "") : (channels.find((c) => c.kind === "voice")?.id ?? ""),
    );
  }, [aberto, encontro, channels]);

  const data = doCampoLocal(quando);
  // Mudar um encontro que já começou pode (corrigir a mesa, por exemplo);
  // marcar um novo no passado não faz sentido.
  const noPassado = !encontro && !!data && data.getTime() < Date.now();
  const valido = !!titulo.trim() && titulo.trim().length <= 80 && !!data && !noPassado;

  const salvar = async () => {
    if (!data) return;
    setSalvando(true);
    const { error } = await supabase.rpc("salvar_encontro", {
      _server_id: serverId,
      _titulo: titulo.trim(),
      _comeca_em: data.toISOString(),
      _descricao: descricao.trim(),
      ...(mesaId ? { _mesa_id: mesaId } : {}),
      ...(encontro ? { _id: encontro.id } : {}),
    });
    setSalvando(false);
    if (error) {
      toast.error("Não consegui salvar o encontro.");
      return;
    }
    await qc.invalidateQueries({ queryKey: ["encontros", serverId] });
    await qc.invalidateQueries({ queryKey: ["historico", serverId] });
    toast.success(encontro ? "Encontro atualizado." : "Encontro marcado! Já aparece no salão.");
    onFechar();
  };

  const mesasPorTipo = [
    { rotulo: "Mesas de voz", mesas: channels.filter((c) => c.kind === "voice") },
    { rotulo: "Mesas de texto", mesas: channels.filter((c) => c.kind !== "voice") },
  ].filter((g) => g.mesas.length > 0);

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="wood-texture scrollbar-thin max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl tracking-wide">
            {encontro ? "Mudar o encontro" : "Marcar um encontro"}
          </DialogTitle>
          <DialogDescription>
            Aparece em destaque no salão, e cada um confirma se vai.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="encontro-titulo">O que vai rolar</Label>
            <Input
              id="encontro-titulo"
              value={titulo}
              maxLength={80}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Campeonato de sexta"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="encontro-quando">Quando</Label>
              <Input
                id="encontro-quando"
                type="datetime-local"
                value={quando}
                onChange={(e) => setQuando(e.target.value)}
              />
              {noPassado && <p className="text-destructive text-xs">Esse horário já passou.</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="encontro-mesa">Em que mesa</Label>
              <select
                id="encontro-mesa"
                value={mesaId}
                onChange={(e) => setMesaId(e.target.value)}
                className={seletor}
              >
                <option value="">Ainda não sei</option>
                {mesasPorTipo.map((g) => (
                  <optgroup key={g.rotulo} label={g.rotulo}>
                    {g.mesas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="encontro-descricao">Recado (opcional)</Label>
            <Textarea
              id="encontro-descricao"
              rows={3}
              maxLength={500}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Traz o controle e a pipoca."
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => void salvar()} disabled={!valido || salvando}>
            <Save className="size-4" />{" "}
            {salvando ? "Salvando..." : encontro ? "Salvar" : "Marcar encontro"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
