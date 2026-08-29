import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AtSign, ImageUp, KeyRound, Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const BIO_MAX = 280;
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_TIPOS = ["image/jpeg", "image/png", "image/webp", "image/gif"];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AccountSettingsDialog({ open, onOpenChange }: Props) {
  const { session, profile, refreshProfile } = useAuth();
  const qc = useQueryClient();

  /**
   * O nome e a foto de cada pessoa também vivem no cache de membros do buteco,
   * carregado por outra query. Sem invalidar, a mudança só apareceria para quem
   * fez a edição, e não no chat nem nas mesas de voz.
   */
  const recarregar = async () => {
    await refreshProfile();
    await qc.invalidateQueries({ queryKey: ["members"] });
  };

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [email, setEmail] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  // Reabrir volta aos valores salvos; ninguém quer achar um rascunho velho.
  useEffect(() => {
    if (!open) return;
    setDisplayName(profile?.display_name ?? "");
    setBio(profile?.bio ?? "");
    setEmail(session?.user.email ?? "");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }, [open, profile, session]);

  const nome = displayName.trim();
  const perfilSujo = nome !== (profile?.display_name ?? "") || bio.trim() !== (profile?.bio ?? "");

  const salvarPerfil = async () => {
    if (!nome) {
      toast.error("O apelido não pode ficar vazio.");
      return;
    }
    setSavingProfile(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: nome, bio: bio.trim() || null })
      .eq("id", session!.user.id);
    setSavingProfile(false);
    if (error) {
      toast.error("Não consegui salvar o perfil.");
      return;
    }
    await recarregar();
    toast.success("Perfil atualizado.");
  };

  const enviarAvatar = async (file: File) => {
    if (!AVATAR_TIPOS.includes(file.type)) {
      toast.error("Manda uma imagem JPG, PNG, WEBP ou GIF.");
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      toast.error("A imagem passou de 2 MB. Escolhe uma menor.");
      return;
    }

    setUploading(true);
    const uid = session!.user.id;
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    // O caminho começa pelo id: é o que a policy do bucket confere.
    const path = `${uid}/avatar.${ext}`;

    const { error: upErr } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true, contentType: file.type });

    if (upErr) {
      setUploading(false);
      toast.error("Não consegui subir a foto.");
      return;
    }

    // A URL pública é estável, então o navegador serviria a foto antiga do
    // cache depois da troca. O carimbo de tempo força a releitura.
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    const url = `${data.publicUrl}?v=${Date.now()}`;

    const { error: dbErr } = await supabase
      .from("profiles")
      .update({ avatar_url: url })
      .eq("id", uid);

    setUploading(false);
    if (dbErr) {
      toast.error("A foto subiu, mas não consegui salvar no perfil.");
      return;
    }
    await recarregar();
    toast.success("Foto no capricho!");
  };

  const removerAvatar = async () => {
    setUploading(true);
    const uid = session!.user.id;
    const { data: arquivos } = await supabase.storage.from("avatars").list(uid);
    if (arquivos?.length) {
      await supabase.storage.from("avatars").remove(arquivos.map((f) => `${uid}/${f.name}`));
    }
    const { error } = await supabase.from("profiles").update({ avatar_url: null }).eq("id", uid);
    setUploading(false);
    if (error) {
      toast.error("Não consegui tirar a foto.");
      return;
    }
    await recarregar();
    toast.success("De volta à tampinha.");
  };

  const trocarEmail = async () => {
    const novo = email.trim();
    if (!novo || novo === session?.user.email) return;
    setSavingEmail(true);
    // Fluxo do próprio Auth: ele dispara a confirmação e só troca depois dela.
    const { error } = await supabase.auth.updateUser({ email: novo });
    setSavingEmail(false);
    if (error) {
      toast.error(
        error.message.includes("already")
          ? "Esse e-mail já está em uso."
          : "Não consegui trocar o e-mail: " + error.message,
      );
      return;
    }
    toast.success("Confirme pelo link que mandamos para o e-mail novo.", { duration: 8000 });
  };

  const trocarSenha = async () => {
    if (newPassword.length < 6) {
      toast.error("A senha nova precisa de pelo menos 6 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("A confirmação não bate com a senha nova.");
      return;
    }
    setSavingPassword(true);

    // Confere a senha atual antes de trocar: a sessão aberta sozinha não prova
    // que é a pessoa dona da conta que está no teclado.
    const { error: reauth } = await supabase.auth.signInWithPassword({
      email: session!.user.email!,
      password: currentPassword,
    });
    if (reauth) {
      setSavingPassword(false);
      toast.error("A senha atual está errada.");
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);
    if (error) {
      toast.error("Não consegui trocar a senha: " + error.message);
      return;
    }
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    toast.success("Senha trocada.");
  };

  const restante = BIO_MAX - bio.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="wood-texture max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl tracking-wide">
            Configurações da conta
          </DialogTitle>
          <DialogDescription>Sua cara no buteco e os dados de acesso.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="perfil">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="perfil">Perfil</TabsTrigger>
            <TabsTrigger value="conta">Acesso</TabsTrigger>
          </TabsList>

          <TabsContent value="perfil" className="mt-6 space-y-5">
            <div className="flex items-center gap-4">
              <Bottlecap
                name={displayName || profile?.username || "?"}
                src={profile?.avatar_url}
                className="size-20 text-2xl"
              />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-sm font-medium">Sua tampinha</p>
                <p className="text-muted-foreground text-xs">
                  Sem foto, a tampinha sai da inicial do apelido. JPG, PNG, WEBP ou GIF, até 2 MB.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                  >
                    {uploading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ImageUp className="size-4" />
                    )}
                    {profile?.avatar_url ? "Trocar foto" : "Subir foto"}
                  </Button>
                  {profile?.avatar_url && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={uploading}
                      onClick={() => void removerAvatar()}
                    >
                      <Trash2 className="size-4" /> Tirar
                    </Button>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept={AVATAR_TIPOS.join(",")}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    // Zera o input: escolher o mesmo arquivo de novo precisa disparar.
                    e.target.value = "";
                    if (file) void enviarAvatar(file);
                  }}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="apelido">Apelido</Label>
              <Input
                id="apelido"
                value={displayName}
                maxLength={40}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Como a turma te chama"
              />
              <p className="text-muted-foreground text-xs">
                Seu usuário (@{profile?.username}) continua o mesmo.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio">Sobre mim</Label>
              <Textarea
                id="bio"
                value={bio}
                maxLength={BIO_MAX}
                rows={3}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Joga o quê? Bebe o quê? Conta aí."
              />
              <p
                className={cn(
                  "text-right text-xs",
                  restante < 20 ? "text-primary" : "text-muted-foreground",
                )}
              >
                {restante} caracteres
              </p>
            </div>

            <Button
              onClick={() => void salvarPerfil()}
              disabled={!perfilSujo || savingProfile || !nome}
              className="w-full"
            >
              {savingProfile ? "Salvando..." : "Salvar perfil"}
            </Button>
          </TabsContent>

          <TabsContent value="conta" className="mt-6 space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email" className="flex items-center gap-2">
                <AtSign className="size-4" /> E-mail
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Trocar manda um link de confirmação. O e-mail só muda depois que você clicar nele.
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => void trocarEmail()}
                disabled={savingEmail || !email.trim() || email.trim() === session?.user.email}
              >
                {savingEmail ? "Enviando..." : "Trocar e-mail"}
              </Button>
            </div>

            <div className="border-border space-y-2 border-t pt-5">
              <Label htmlFor="senha-atual" className="flex items-center gap-2">
                <KeyRound className="size-4" /> Trocar senha
              </Label>
              <Input
                id="senha-atual"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Senha atual"
              />
              <Input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Senha nova"
              />
              <Input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repete a senha nova"
              />
              <Button
                variant="outline"
                className="w-full"
                onClick={() => void trocarSenha()}
                disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword}
              >
                {savingPassword ? "Trocando..." : "Trocar senha"}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
