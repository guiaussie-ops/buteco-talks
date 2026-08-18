import { createFileRoute, Link } from "@tanstack/react-router";
import { MonitorUp, MessagesSquare, Mic, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Praça — comunidades com voz e compartilhamento de tela" },
      {
        name: "description",
        content:
          "Crie sua comunidade, converse por texto, entre em salas de voz e compartilhe a tela para ajudar seus amigos. Câmera e tela bloqueadas para menores de 18 anos.",
      },
      { property: "og:title", content: "Praça — sua comunidade, sua tela, seu espaço" },
      {
        property: "og:description",
        content:
          "Texto, voz e compartilhamento de tela entre amigos, com proteção de idade integrada.",
      },
    ],
  }),
  component: Landing,
});

const features = [
  {
    icon: MessagesSquare,
    title: "Canais de texto",
    text: "Converse em tempo real em canais organizados por assunto dentro de cada comunidade.",
  },
  {
    icon: Mic,
    title: "Salas de voz",
    text: "Entre em uma sala e fale com todo mundo, com áudio ponto a ponto direto no navegador.",
  },
  {
    icon: MonitorUp,
    title: "Compartilhar tela",
    text: "Mostre sua tela para resolver problemas juntos, com vídeo em alta definição.",
  },
  {
    icon: ShieldCheck,
    title: "Proteção de idade",
    text: "Menores de 18 anos podem conversar, mas câmera e tela ficam bloqueadas — inclusive no servidor.",
  },
];

function Landing() {
  const { session } = useAuth();

  return (
    <main className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <div className="bg-gradient-neon flex size-9 items-center justify-center rounded-xl text-lg font-bold text-primary-foreground">
            P
          </div>
          <span className="font-display text-lg font-semibold">Praça</span>
        </div>
        <Button asChild variant="secondary" size="sm">
          <Link to={session ? "/app" : "/entrar"}>{session ? "Abrir app" : "Entrar"}</Link>
        </Button>
      </header>

      <section className="mx-auto max-w-6xl px-6 pt-10 pb-20 sm:pt-20">
        <p className="text-primary mb-4 text-xs font-semibold tracking-[0.2em] uppercase">
          Comunidades sem intermediários
        </p>
        <h1 className="max-w-3xl text-4xl leading-[1.05] font-bold sm:text-6xl">
          Sua turma, sua sala de voz,{" "}
          <span className="text-gradient-neon">sua tela compartilhada.</span>
        </h1>
        <p className="text-muted-foreground mt-6 max-w-xl text-lg">
          Um lugar simples para criar comunidades, conversar por texto, entrar em salas de voz e
          mostrar a tela para resolver problemas junto com os amigos.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg" className="glow-ring">
            <Link to={session ? "/app" : "/entrar"}>
              {session ? "Ir para minhas comunidades" : "Criar minha comunidade"}
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/entrar">Já tenho conta</Link>
          </Button>
        </div>

        <div className="mt-20 grid gap-4 sm:grid-cols-2">
          {features.map((f) => (
            <div
              key={f.title}
              className="bg-card border-border hover:border-primary/40 rounded-2xl border p-6 transition-colors"
            >
              <f.icon className="text-primary size-6" />
              <h2 className="mt-4 text-lg font-semibold">{f.title}</h2>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-border text-muted-foreground border-t px-6 py-8 text-center text-xs">
        Praça — feito para conversar com quem importa.
      </footer>
    </main>
  );
}
