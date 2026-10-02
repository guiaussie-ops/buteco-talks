import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DoorOpen, Frown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/convite/$code")({
  head: () => ({
    meta: [
      { title: "Convite — Buteco" },
      { name: "description", content: "Você foi chamado pra um buteco. Puxe uma cadeira." },
    ],
  }),
  component: InvitePage,
});

type State = "checking" | "joining" | "not_found" | "expired" | "banned" | "error";

const FALHAS: Record<Exclude<State, "checking" | "joining">, { titulo: string; texto: string }> = {
  not_found: {
    titulo: "Esse convite não vale mais",
    texto:
      "O código pode ter sido trocado pelo dono do buteco, ou veio digitado errado. Peça um link novo pra quem te chamou.",
  },
  expired: {
    titulo: "Esse convite venceu",
    texto: "Ele tinha prazo ou número de usos, e acabou. Peça um link novo pra quem te chamou.",
  },
  banned: {
    titulo: "Porta fechada pra você",
    texto: "Você foi banido desse buteco, e convite nenhum abre essa porta.",
  },
  error: {
    titulo: "Deu ruim no convite",
    texto: "Algo falhou no caminho. Tenta de novo daqui a pouco.",
  },
};

function InvitePage() {
  const { code } = Route.useParams();
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [state, setState] = useState<State>("checking");
  // StrictMode monta duas vezes em dev; sem isso o convite seria resgatado em dobro.
  const tried = useRef(false);

  useEffect(() => {
    if (loading) return;

    // Sem sessão: manda pro login e volta pra cá depois de entrar.
    if (!session) {
      void navigate({ to: "/entrar", search: { redirect: `/convite/${code}` }, replace: true });
      return;
    }

    if (tried.current) return;
    tried.current = true;

    void (async () => {
      setState("joining");
      const { data, error } = await supabase.rpc("join_server_by_code", { _code: code });
      if (error) {
        setState("error");
        toast.error("Não consegui abrir esse convite.");
        return;
      }
      const status = (data as { status?: string } | null)?.status;
      if (status === "joined") {
        toast.success("Você puxou a cadeira! Bem-vindo ao buteco.");
        void navigate({ to: "/app", replace: true });
      } else if (status === "already_member") {
        toast.info("Você já está nesse buteco.");
        void navigate({ to: "/app", replace: true });
      } else if (status === "expired" || status === "banned") {
        setState(status);
      } else {
        setState("not_found");
      }
    })();
  }, [loading, session, code, navigate]);

  const falha = state === "checking" || state === "joining" ? null : FALHAS[state];

  return (
    <div className="wood-texture flex min-h-screen items-center justify-center p-6">
      <div className="border-border bg-surface w-full max-w-md rounded-2xl border p-8 text-center">
        {falha ? (
          <>
            <span className="bg-surface-2 text-muted-foreground mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl">
              <Frown className="size-7" />
            </span>
            <h1 className="font-display mb-2 text-2xl tracking-wide">{falha.titulo}</h1>
            <p className="text-muted-foreground mb-6 text-sm">{falha.texto}</p>
            <Button asChild>
              <Link to="/app">Ir pros meus butecos</Link>
            </Button>
          </>
        ) : (
          <>
            <span className="bg-gradient-amber text-primary-foreground glow-ring mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl">
              <DoorOpen className="size-7" />
            </span>
            <h1 className="font-display mb-2 text-2xl tracking-wide">Abrindo a porta...</h1>
            <p className="text-muted-foreground text-sm">
              Só um instante, já te colocamos na mesa.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
