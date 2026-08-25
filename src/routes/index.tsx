import { createFileRoute, Link } from "@tanstack/react-router";
import { MonitorUp, MessagesSquare, Mic, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Buteco — gameplay raiz e resenha sem filtro" },
      {
        name: "description",
        content:
          "Abra seu buteco: mesas de texto, mesas de voz e tela compartilhada em alta definição para jogar e resolver as coisas com a turma. Sem intermediários.",
      },
      { property: "og:title", content: "Buteco — sua turma, sua mesa de voz, sua tela" },
      {
        property: "og:description",
        content:
          "Comunidade de voz e texto para jogar com os amigos, com compartilhamento de tela e proteção de idade.",
      },
    ],
  }),
  component: Landing,
});

const features = [
  {
    icon: MessagesSquare,
    title: "Mesas de texto",
    text: "Resenha em tempo real, organizada por assunto dentro de cada buteco.",
  },
  {
    icon: Mic,
    title: "Mesas de voz",
    text: "Puxa a cadeira e fala com a galera: áudio ponto a ponto direto no navegador.",
  },
  {
    icon: MonitorUp,
    title: "Compartilhar tela",
    text: "Mostre o gameplay ou o problema em alta definição e resolvam juntos.",
  },
  {
    icon: ShieldCheck,
    title: "Proteção de idade",
    text: "Menor de 18 conversa e fala normal, mas câmera e tela ficam travadas — no servidor também.",
  },
];

function Landing() {
  const { session } = useAuth();

  return (
    <main className="bar-vignette bg-background relative min-h-screen overflow-hidden">
      <div className="bar-glow pointer-events-none absolute inset-x-0 top-0 h-[560px]" />

      <div className="relative">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
          <span className="neon-text font-display text-2xl leading-none tracking-[0.14em]">
            BUTECO
          </span>
          <Button asChild variant="secondary" size="sm">
            <Link to={session ? "/app" : "/entrar"}>
              {session ? "Voltar pra mesa" : "Puxar uma cadeira"}
            </Link>
          </Button>
        </header>

        <section className="mx-auto max-w-6xl px-6 pt-12 pb-20 text-center sm:pt-20">
          <h1 className="neon-sign font-display text-6xl leading-[0.9] tracking-[0.08em] sm:text-8xl">
            BUTECO
          </h1>
          <p className="text-muted-foreground mt-3 text-sm tracking-[0.3em] uppercase">
            Gameplay raiz · resenha sem filtro
          </p>

          <h2 className="text-foreground mx-auto mt-10 max-w-3xl font-display text-4xl leading-tight tracking-wide sm:text-5xl">
            Sua turma, sua mesa de voz,{" "}
            <span className="text-gradient-amber">sua tela compartilhada.</span>
          </h2>
          <p className="text-muted-foreground mx-auto mt-5 max-w-xl text-base leading-relaxed">
            Um lugar simples pra criar comunidades, conversar por texto, entrar em mesas de voz e
            mostrar a tela pra resolver as coisas junto com os amigos — sem intermediários, sem
            depender de ninguém.
          </p>

          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" className="glow-ring">
              <Link to={session ? "/app" : "/entrar"}>
                {session ? "Ir pros meus butecos" : "Abrir meu buteco"}
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/entrar">Já tenho conta</Link>
            </Button>
          </div>

          <div className="mt-20 grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-4">
            {features.map((f) => (
              <div
                key={f.title}
                className="wood-texture border-border hover:border-primary/50 rounded-2xl border p-6 transition-colors"
              >
                <f.icon className="text-primary size-6" />
                <h3 className="mt-4 font-display text-xl tracking-wide">{f.title}</h3>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        <footer className="border-border text-muted-foreground border-t px-6 py-8 text-center text-xs">
          Buteco — o bar da sua turma, aberto a noite toda.
        </footer>
      </div>
    </main>
  );
}
