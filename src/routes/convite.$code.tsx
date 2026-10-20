import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, DoorOpen, Frown, Megaphone, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  PORTA_FECHADA,
  lerVitrine,
  limitesDoConvite,
  mesasPorCategoria,
  passosDe,
  quadroDe,
  statusDaEntrada,
  type Passo,
  type StatusDoConvite,
  type Vitrine,
} from "@/lib/convite";
import { regrasDoTexto } from "@/lib/quadro";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { MiniMesa } from "@/components/app/Mesas";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/convite/$code")({
  head: () => ({
    meta: [
      { title: "Convite — Buteco" },
      { name: "description", content: "Você foi chamado pra um buteco. Puxe uma cadeira." },
    ],
  }),
  component: InvitePage,
});

/**
 * A porta do buteco para quem chega por convite. Antes de sentar, a pessoa vê
 * onde está entrando: o buteco e o quadro dele, as regras da casa e as mesas.
 * Dá para ver tudo sem conta; a conta só é pedida na hora de puxar a cadeira,
 * e depois do cadastro a pessoa volta aqui, direto no último passo.
 */
function InvitePage() {
  const { code } = Route.useParams();
  const { session, loading } = useAuth();
  const uid = session?.user.id ?? null;

  // A chave leva quem está olhando: depois do login o status muda (já é
  // membro, foi banido), e a vitrine precisa ser pedida de novo.
  const vitrine = useQuery({
    queryKey: ["convite", code, uid],
    enabled: !loading,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ver_convite", { _code: code });
      if (error) throw error;
      return lerVitrine(data);
    },
  });

  return (
    <div className="wood-texture flex min-h-screen items-center justify-center p-4 sm:p-6">
      <div className="border-border bg-surface w-full max-w-lg rounded-2xl border p-6 sm:p-8">
        {vitrine.isError ? (
          <Aviso
            titulo="Deu ruim no convite"
            texto="Não consegui abrir a porta agora. Confira sua internet e tenta de novo."
          >
            <Button onClick={() => void vitrine.refetch()}>Tentar de novo</Button>
          </Aviso>
        ) : !vitrine.data ? (
          <Abrindo />
        ) : (
          <Porta code={code} vitrine={vitrine.data} logado={!!session} />
        )}
      </div>
    </div>
  );
}

function Porta({ code, vitrine, logado }: { code: string; vitrine: Vitrine; logado: boolean }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const passos = passosDe(vitrine);
  const chaveVisto = `buteco:convite-visto:${code}`;
  // Quem já percorreu tudo e foi criar a conta volta direto para o último passo.
  const [passo, setPasso] = useState(() => {
    try {
      return logado && window.sessionStorage.getItem(chaveVisto) ? passos.length - 1 : 0;
    } catch {
      return 0;
    }
  });
  const [combinado, setCombinado] = useState(passo > 0);
  const [entrando, setEntrando] = useState(false);
  // O convite pode fechar entre a vitrine e o clique (esgotou, venceu).
  const [fechou, setFechou] = useState<StatusDoConvite | null>(null);

  const atual: Passo = passos[Math.min(passo, passos.length - 1)]!;
  const ultimo = passo >= passos.length - 1;

  useEffect(() => {
    if (!ultimo) return;
    try {
      window.sessionStorage.setItem(chaveVisto, "1");
    } catch {
      // Sem storage, quem voltar do cadastro só refaz o caminho.
    }
  }, [ultimo, chaveVisto]);

  const irProSalao = (serverId: string) => {
    // A lista de butecos em cache é de antes de entrar: sem apagar, o /app
    // acharia que o buteco novo não é meu.
    qc.removeQueries({ queryKey: ["servers"] });
    void navigate({ to: "/app", search: { buteco: serverId }, replace: true });
  };

  const puxarCadeira = async () => {
    setEntrando(true);
    const { data, error } = await supabase.rpc("join_server_by_code", { _code: code });
    setEntrando(false);
    if (error) {
      toast.error("Não consegui abrir esse convite. Tenta de novo.");
      return;
    }
    const resposta = data as { status?: string; server_id?: string } | null;
    const status = statusDaEntrada(resposta?.status);
    if ((status === "entrou" || status === "ja_e_membro") && resposta?.server_id) {
      try {
        window.sessionStorage.removeItem(chaveVisto);
      } catch {
        // Nada a limpar.
      }
      toast.success(
        status === "entrou"
          ? "Você puxou a cadeira! Bem-vindo ao buteco."
          : "Você já está nesse buteco.",
      );
      irProSalao(resposta.server_id);
      return;
    }
    setFechou(status === "entrou" ? "invalido" : status);
  };

  const status = fechou ?? vitrine.status;
  if (status !== "valido" && status !== "ja_e_membro") {
    const { titulo, texto } = PORTA_FECHADA[status];
    return (
      <Aviso titulo={titulo} texto={texto} buteco={vitrine.buteco?.nome}>
        <Button asChild>
          <Link to={logado ? "/app" : "/"}>
            {logado ? "Ir pros meus butecos" : "Voltar pro início"}
          </Link>
        </Button>
      </Aviso>
    );
  }

  const nome = vitrine.buteco?.nome ?? "Buteco";
  const emoji = vitrine.buteco?.emoji || nome.slice(0, 1).toUpperCase();

  if (status === "ja_e_membro" && vitrine.server_id) {
    const serverId = vitrine.server_id;
    return (
      <div className="text-center">
        <Placa emoji={emoji} />
        <h1 className="font-display mb-2 text-2xl tracking-wide">Você já está no {nome}</h1>
        <p className="text-muted-foreground mb-6 text-sm">Sua cadeira continua lá.</p>
        <Button onClick={() => irProSalao(serverId)}>
          <DoorOpen className="size-4" /> Ir pro salão
        </Button>
      </div>
    );
  }

  const quadro = quadroDe(vitrine);
  const membros = vitrine.membros ?? 0;
  const limites = limitesDoConvite(vitrine);
  const regras = regrasDoTexto(quadro.regras);
  const travado = atual === "regras" && !combinado;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center gap-3">
        <Placa emoji={emoji} pequena />
        <div className="min-w-0 flex-1">
          <p className="text-muted-foreground text-xs">Você foi chamado pro</p>
          <h1 className="font-display truncate text-2xl leading-tight tracking-wide">{nome}</h1>
        </div>
        <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
          <Users className="size-3.5" />
          {membros} {membros === 1 ? "pessoa" : "pessoas"}
        </span>
      </header>

      <ol className="flex gap-1.5" aria-label="Passos da entrada">
        {passos.map((p, i) => (
          <li
            key={p}
            aria-current={i === passo ? "step" : undefined}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors",
              i <= passo ? "bg-primary" : "bg-surface-2",
            )}
          >
            <span className="sr-only">{ROTULO_DO_PASSO[p]}</span>
          </li>
        ))}
      </ol>

      <section className="min-h-[180px]">
        {atual === "porta" && (
          <div className="flex flex-col gap-4">
            {quadro.aviso.trim() && (
              <p className="bg-neon text-neon-foreground flex items-start gap-2 rounded-lg px-4 py-2.5 text-sm font-medium">
                <Megaphone className="mt-0.5 size-4 shrink-0" />
                <span className="whitespace-pre-line">{quadro.aviso}</span>
              </p>
            )}
            {quadro.boas_vindas.trim() ? (
              <p className="bg-papel text-papel-tinta rounded-lg px-4 py-3 text-sm leading-relaxed whitespace-pre-line">
                {quadro.boas_vindas}
              </p>
            ) : (
              <p className="text-muted-foreground text-sm">
                Aqui a turma se encontra pra conversar por texto e sentar nas mesas de voz.
              </p>
            )}
            <p className="text-muted-foreground text-sm">
              Antes de puxar a cadeira, dá uma olhada em como funciona a casa. É rapidinho.
            </p>
            {limites.length > 0 && (
              <p className="text-muted-foreground text-xs">Esse convite {limites.join(" e ")}.</p>
            )}
          </div>
        )}

        {atual === "regras" && (
          <div className="flex flex-col gap-4">
            <h2 className="font-display text-xl tracking-wide">Regras da casa</h2>
            <ol className="bg-papel text-papel-tinta flex list-inside list-decimal flex-col gap-1.5 rounded-lg px-4 py-3 text-sm">
              {regras.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ol>
            <label className="flex cursor-pointer items-center gap-2.5 text-sm">
              <Checkbox checked={combinado} onCheckedChange={(v) => setCombinado(v === true)} />
              Li as regras e combino com elas
            </label>
          </div>
        )}

        {atual === "mesas" && (
          <div className="flex flex-col gap-4">
            <h2 className="font-display text-xl tracking-wide">As mesas</h2>
            <ul className="text-muted-foreground flex flex-col gap-2 text-sm">
              <li className="flex items-center gap-3">
                <MiniMesa tipo="text" />
                <span>
                  <strong className="text-foreground">Mesa de texto:</strong> conversa escrita, fica
                  tudo guardado.
                </span>
              </li>
              <li className="flex items-center gap-3">
                <MiniMesa tipo="voice" />
                <span>
                  <strong className="text-foreground">Mesa de voz:</strong> senta e fala, com
                  microfone. Dá pra mostrar a tela também.
                </span>
              </li>
            </ul>
            {vitrine.mesas && vitrine.mesas.length > 0 ? (
              <div className="border-border bg-rail/60 scrollbar-thin flex max-h-56 flex-col gap-3 overflow-y-auto rounded-lg border p-3">
                {mesasPorCategoria(vitrine.mesas).map((g, i) => (
                  <div key={i}>
                    {g.categoria && (
                      <p className="text-muted-foreground mb-1 text-[11px] tracking-[0.12em] uppercase">
                        {g.categoria}
                      </p>
                    )}
                    <ul className="flex flex-col gap-1">
                      {g.mesas.map((m, j) => (
                        <li key={j} className="flex items-center gap-2.5 text-sm">
                          <MiniMesa tipo={m.tipo} className="scale-75" />
                          <span className="truncate">{m.nome}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                O salão ainda não tem mesa. Quem cuida do buteco bota a primeira logo.
              </p>
            )}
            <p className="text-muted-foreground text-sm">
              Lá dentro, é só clicar numa mesa pra sentar.
            </p>
          </div>
        )}
      </section>

      <footer className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        {passo > 0 ? (
          <Button variant="ghost" onClick={() => setPasso(passo - 1)}>
            <ArrowLeft className="size-4" /> Voltar
          </Button>
        ) : (
          <span className="hidden sm:block" />
        )}
        <div className="flex flex-col gap-2 sm:ml-auto sm:flex-row-reverse">
          {!ultimo ? (
            <Button onClick={() => setPasso(passo + 1)} disabled={travado}>
              {passos[passo + 1] === "regras" ? "Ver as regras" : "Ver as mesas"}
              <ArrowRight className="size-4" />
            </Button>
          ) : logado ? (
            <Button onClick={() => void puxarCadeira()} disabled={entrando}>
              <DoorOpen className="size-4" /> {entrando ? "Abrindo a porta..." : "Puxar a cadeira"}
            </Button>
          ) : (
            <>
              <Button asChild>
                <Link to="/entrar" search={{ redirect: `/convite/${code}`, aba: "criar" }}>
                  Criar minha conta e entrar
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/entrar" search={{ redirect: `/convite/${code}` }}>
                  Já tenho conta
                </Link>
              </Button>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}

const ROTULO_DO_PASSO: Record<Passo, string> = {
  porta: "O buteco",
  regras: "Regras da casa",
  mesas: "As mesas",
};

function Placa({ emoji, pequena }: { emoji: string; pequena?: boolean }) {
  return (
    <span
      className={cn(
        "bg-gradient-amber text-primary-foreground glow-ring flex shrink-0 items-center justify-center rounded-2xl",
        pequena ? "size-12 text-2xl" : "mx-auto mb-4 size-14 text-3xl",
      )}
    >
      {emoji}
    </span>
  );
}

function Abrindo() {
  return (
    <div className="text-center">
      <span className="bg-gradient-amber text-primary-foreground glow-ring mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl">
        <DoorOpen className="size-7" />
      </span>
      <h1 className="font-display mb-2 text-2xl tracking-wide">Abrindo a porta...</h1>
      <p className="text-muted-foreground text-sm">Só um instante.</p>
    </div>
  );
}

function Aviso({
  titulo,
  texto,
  buteco,
  children,
}: {
  titulo: string;
  texto: string;
  buteco?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="text-center">
      <span className="bg-surface-2 text-muted-foreground mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl">
        <Frown className="size-7" />
      </span>
      {buteco && <p className="text-muted-foreground mb-1 text-xs">Convite pro {buteco}</p>}
      <h1 className="font-display mb-2 text-2xl tracking-wide">{titulo}</h1>
      <p className="text-muted-foreground mb-6 text-sm">{texto}</p>
      {children}
    </div>
  );
}
