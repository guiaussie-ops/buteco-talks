import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, calcAge } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/entrar")({
  // O retorno precisa ter `redirect` opcional: se ele virar obrigatório, todo
  // <Link to="/entrar"> do app passa a exigir search.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const value = search["redirect"];
    return typeof value === "string" ? { redirect: value } : {};
  },
  head: () => ({
    meta: [
      { title: "Puxar uma cadeira — Buteco" },
      {
        name: "description",
        content: "Entre na sua conta ou crie a sua para participar dos butecos da sua turma.",
      },
      { property: "og:title", content: "Puxar uma cadeira — Buteco" },
      {
        property: "og:description",
        content: "Entre na sua conta ou crie a sua para participar dos butecos da sua turma.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const { redirect } = Route.useSearch();
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("login");

  /**
   * Volta pra onde a pessoa estava antes do login. Só reconhecemos a rota de
   * convite: aceitar uma URL qualquer aqui viraria um open redirect.
   */
  const goNext = () => {
    const code = redirect?.match(/^\/convite\/([A-Za-z0-9]+)$/)?.[1];
    if (code) {
      void navigate({ to: "/convite/$code", params: { code } });
      return;
    }
    void navigate({ to: "/app" });
  };

  useEffect(() => {
    if (session) goNext();
    // goNext depende de redirect/navigate, ambos estáveis dentro da tela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, navigate, redirect]);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [birthDate, setBirthDate] = useState("");

  const age = calcAge(birthDate || null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail.trim(),
      password: loginPassword,
    });
    setLoading(false);
    if (error) {
      toast.error(
        error.message.includes("Invalid login")
          ? "E-mail ou senha incorretos."
          : "Não consegui entrar: " + error.message,
      );
      return;
    }
    goNext();
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!birthDate) {
      toast.error("Informe sua data de nascimento.");
      return;
    }
    if (age === null || age < 13) {
      toast.error("É preciso ter pelo menos 13 anos para criar uma conta.");
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/app`,
        data: {
          display_name: displayName.trim(),
          username: username.trim().toLowerCase().replace(/\s+/g, "_"),
          birth_date: birthDate,
        },
      },
    });
    setLoading(false);
    if (error) {
      toast.error(
        error.message.includes("already registered")
          ? "Esse e-mail já tem conta. Faça login."
          : "Não consegui criar a conta: " + error.message,
      );
      return;
    }
    if (!data.session) {
      toast.success("Conta criada! Confirme o e-mail que mandamos pra poder puxar a cadeira.");
      setTab("login");
      return;
    }
    toast.success("Conta criada! Bem-vindo ao Buteco.");
    goNext();
  };

  return (
    <main className="bar-vignette relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="bar-glow pointer-events-none absolute inset-x-0 top-0 h-96" />
      <div className="relative w-full max-w-md">
        <Link to="/" className="mb-8 flex items-center justify-center">
          <span className="neon-sign font-display text-4xl leading-none tracking-[0.14em]">
            BUTECO
          </span>
        </Link>

        <div className="wood-texture border-border rounded-2xl border p-6 shadow-2xl">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Puxar cadeira</TabsTrigger>
              <TabsTrigger value="signup">Criar conta</TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="mt-6">
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email">E-mail</Label>
                  <Input
                    id="login-email"
                    type="email"
                    required
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="voce@email.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">Senha</Label>
                  <Input
                    id="login-password"
                    type="password"
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Entrando..." : "Puxar uma cadeira"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup" className="mt-6">
              <form onSubmit={handleSignup} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="display-name">Apelido</Label>
                    <Input
                      id="display-name"
                      required
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Guilherme"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="username">Usuário</Label>
                    <Input
                      id="username"
                      required
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="gui"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="birth">Data de nascimento</Label>
                  <Input
                    id="birth"
                    type="date"
                    required
                    value={birthDate}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setBirthDate(e.target.value)}
                  />
                  <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
                    <ShieldCheck className="text-primary mt-0.5 size-3.5 shrink-0" />
                    Usada só pra liberar câmera e compartilhamento de tela a partir dos 18 anos.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">E-mail</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Senha</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Criando..." : "Criar minha conta"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </main>
  );
}
