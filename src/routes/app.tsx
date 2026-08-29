import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useVoice } from "@/lib/voice";
import { ServerRail, type ServerItem } from "@/components/app/ServerRail";
import { ChannelSidebar, type Channel } from "@/components/app/ChannelSidebar";
import { ChatPanel } from "@/components/app/ChatPanel";
import { VoicePanel } from "@/components/app/VoicePanel";
import { ServerSettingsDialog } from "@/components/app/ServerSettingsDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/app")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Meus butecos — Buteco" },
      {
        name: "description",
        content: "Converse por texto, entre nas mesas de voz e compartilhe sua tela com a turma.",
      },
      { property: "og:title", content: "Meus butecos — Buteco" },
      {
        property: "og:description",
        content: "Converse por texto, entre nas mesas de voz e compartilhe sua tela com a turma.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AppPage,
});

type ServerFull = ServerItem & { invite_code: string; my_role: string };

function AppPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { session, profile, loading, isAdult, signOut } = useAuth();
  const voice = useVoice();
  const uid = session?.user.id ?? null;

  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [serverName, setServerName] = useState("");
  const [inviteInput, setInviteInput] = useState("");

  useEffect(() => {
    if (!loading && !session) void navigate({ to: "/entrar" });
  }, [loading, session, navigate]);

  const serversQuery = useQuery({
    queryKey: ["servers", uid],
    enabled: !!uid,
    queryFn: async (): Promise<ServerFull[]> => {
      const { data, error } = await supabase
        .from("server_members")
        .select("role, server:servers(id, name, icon_emoji, owner_id, invite_code)")
        .eq("user_id", uid!);
      if (error) throw error;
      return (data ?? [])
        .map((r) => ({ ...(r.server as unknown as ServerFull), my_role: r.role }))
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  const servers = useMemo(() => serversQuery.data ?? [], [serversQuery.data]);
  const activeServer = servers.find((s) => s.id === activeServerId) ?? null;

  useEffect(() => {
    if (!activeServerId && servers.length > 0) setActiveServerId(servers[0]!.id);
  }, [servers, activeServerId]);

  const channelsQuery = useQuery({
    queryKey: ["channels", activeServerId],
    enabled: !!activeServerId,
    queryFn: async (): Promise<Channel[]> => {
      const { data, error } = await supabase
        .from("channels")
        .select("id, name, kind, server_id")
        .eq("server_id", activeServerId!)
        .order("kind", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Channel[];
    },
  });

  const channels = useMemo(() => channelsQuery.data ?? [], [channelsQuery.data]);

  useEffect(() => {
    if (!activeServerId) return;
    if (activeChannel && activeChannel.server_id === activeServerId) return;
    const first = channels.find((c) => c.kind === "text") ?? channels[0] ?? null;
    setActiveChannel(first);
  }, [channels, activeServerId, activeChannel]);

  const membersQuery = useQuery({
    queryKey: ["members", activeServerId],
    enabled: !!activeServerId,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data: members, error } = await supabase
        .from("server_members")
        .select("user_id")
        .eq("server_id", activeServerId!);
      if (error) throw error;
      const ids = (members ?? []).map((m) => m.user_id);
      if (ids.length === 0) return {};
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name, username")
        .in("id", ids);
      const map: Record<string, string> = {};
      (profiles ?? []).forEach((p) => {
        map[p.id] = p.display_name || p.username;
      });
      return map;
    },
  });

  const names = membersQuery.data ?? {};

  const createServer = useMutation({
    mutationFn: async (name: string) => {
      // O RETURNING de .select() passa pela policy "members read servers", que exige
      // ser membro — vinculo que so existe apos o insert em server_members. Geramos o
      // id no cliente para nao depender da leitura da linha recem-criada.
      const serverId = crypto.randomUUID();
      const { error } = await supabase
        .from("servers")
        .insert({ id: serverId, name, owner_id: uid!, icon_emoji: name.slice(0, 1).toUpperCase() });
      if (error) throw error;
      const { error: memberError } = await supabase
        .from("server_members")
        .insert({ server_id: serverId, user_id: uid!, role: "owner" });
      if (memberError) throw memberError;
      const { error: channelError } = await supabase.from("channels").insert([
        { server_id: serverId, name: "geral", kind: "text" },
        { server_id: serverId, name: "sala-de-tela", kind: "voice" },
      ]);
      if (channelError) throw channelError;
      return serverId;
    },
    onSuccess: async (id) => {
      await qc.invalidateQueries({ queryKey: ["servers", uid] });
      setActiveServerId(id);
      setActiveChannel(null);
      setCreateOpen(false);
      setServerName("");
      toast.success("Buteco aberto! Chama a galera.");
    },
    onError: () => toast.error("Não consegui abrir o buteco."),
  });

  const joinServer = useMutation({
    mutationFn: async (code: string) => {
      const { data, error } = await supabase.rpc("join_server_by_code", { _code: code.trim().toLowerCase() });
      if (error) throw error;
      return data as string;
    },
    onSuccess: async (id) => {
      await qc.invalidateQueries({ queryKey: ["servers", uid] });
      setActiveServerId(id);
      setActiveChannel(null);
      setJoinOpen(false);
      setInviteInput("");
      toast.success("Você puxou a cadeira! Bem-vindo ao buteco.");
    },
    onError: () => toast.error("Convite inválido."),
  });

  const createChannel = async (name: string, kind: "text" | "voice") => {
    const { error } = await supabase.from("channels").insert({ server_id: activeServerId!, name, kind });
    if (error) {
      toast.error("Não consegui criar a mesa.");
      return;
    }
    await qc.invalidateQueries({ queryKey: ["channels", activeServerId] });
  };

  const canManage =
    !!activeServer && (activeServer.owner_id === uid || activeServer.my_role === "admin");
  const isOwner = !!activeServer && activeServer.owner_id === uid;

  const saveServer = async (name: string, iconEmoji: string) => {
    if (!activeServer) return;
    const { error } = await supabase
      .from("servers")
      .update({ name, icon_emoji: iconEmoji })
      .eq("id", activeServer.id);
    if (error) {
      toast.error("Não consegui salvar as configurações do buteco.");
      return;
    }
    await qc.invalidateQueries({ queryKey: ["servers", uid] });
    toast.success("Buteco atualizado.");
  };

  const deleteServer = async () => {
    if (!activeServer) return;
    const { error } = await supabase.from("servers").delete().eq("id", activeServer.id);
    if (error) {
      toast.error("Não consegui fechar o buteco.");
      return;
    }
    setSettingsOpen(false);
    setActiveServerId(null);
    setActiveChannel(null);
    await qc.invalidateQueries({ queryKey: ["servers", uid] });
    toast.success("Buteco fechado.");
  };

  const renameChannel = async (channelId: string, name: string) => {
    const { error } = await supabase.from("channels").update({ name }).eq("id", channelId);
    if (error) {
      toast.error("Não consegui renomear a mesa.");
      return;
    }
    await qc.invalidateQueries({ queryKey: ["channels", activeServerId] });
    toast.success("Mesa renomeada.");
  };

  const deleteChannel = async (channelId: string) => {
    // messages e voice_participants somem junto por ON DELETE CASCADE.
    const { error } = await supabase.from("channels").delete().eq("id", channelId);
    if (error) {
      toast.error("Não consegui apagar a mesa.");
      return;
    }
    if (activeChannel?.id === channelId) setActiveChannel(null);
    if (voice.active?.channelId === channelId) voice.leave();
    await qc.invalidateQueries({ queryKey: ["channels", activeServerId] });
    toast.success("Mesa apagada.");
  };

  if (loading || !session || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground text-sm">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <ServerRail
        servers={servers}
        activeId={activeServerId}
        onSelect={(id) => {
          setActiveServerId(id);
          setActiveChannel(null);
        }}
        onCreate={() => setCreateOpen(true)}
        onJoin={() => setJoinOpen(true)}
      />

      {activeServer ? (
        <>
          <ChannelSidebar
            serverName={activeServer.name}
            inviteCode={activeServer.invite_code}
            channels={channels}
            activeChannelId={activeChannel?.id ?? null}
            onSelect={(c) => {
              setActiveChannel(c);
              // Entrar na mesa de voz é uma acao explicita; mudar de canal de texto
              // depois disso nao derruba a conexao.
              if (c.kind === "voice") {
                voice.join({ channelId: c.id, channelName: c.name, serverId: activeServer.id });
              }
            }}
            isOwner={isOwner}
            canManage={canManage}
            onOpenSettings={() => setSettingsOpen(true)}
            onRenameChannel={renameChannel}
            onDeleteChannel={deleteChannel}
            onCreateChannel={createChannel}
            displayName={profile.display_name || profile.username}
            isAdult={isAdult}
            onSignOut={() => void signOut()}
            serverId={activeServer.id}
            names={names}
            onOpenVoiceRoom={(channelId) => {
              const c = channels.find((ch) => ch.id === channelId);
              if (c) setActiveChannel(c);
            }}
          />
          {activeChannel ? (
            activeChannel.kind === "voice" ? (
              <VoicePanel
                key={activeChannel.id}
                channelId={activeChannel.id}
                channelName={activeChannel.name}
                userId={uid!}
                isAdult={isAdult}
                names={names}
                onLeave={() => {
                  voice.leave();
                  const text = channels.find((c) => c.kind === "text");
                  setActiveChannel(text ?? null);
                }}
              />
            ) : (
              <ChatPanel
                key={activeChannel.id}
                channelId={activeChannel.id}
                channelName={activeChannel.name}
                userId={uid!}
                names={names}
              />
            )
          ) : (
            <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
              Escolha uma mesa
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className="font-display text-3xl tracking-wide">Você ainda não tem nenhum buteco</h1>
          <p className="text-muted-foreground max-w-sm text-sm">
            Abra o seu buteco e chame a galera, ou puxe uma cadeira usando o convite de um amigo.
          </p>
          <div className="flex gap-2">
            <Button onClick={() => setCreateOpen(true)}>Abrir um buteco</Button>
            <Button variant="outline" onClick={() => setJoinOpen(true)}>
              Usar convite
            </Button>
          </div>
        </div>
      )}

      {activeServer && (
        <ServerSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          serverName={activeServer.name}
          iconEmoji={activeServer.icon_emoji}
          isOwner={isOwner}
          onSave={saveServer}
          onDelete={deleteServer}
        />
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-2xl tracking-wide">Abrir um buteco</DialogTitle>
            <DialogDescription>
              Ele já vem com uma mesa de texto e uma mesa de voz com compartilhamento de tela.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="server-name">Nome do buteco</Label>
            <Input
              id="server-name"
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
              placeholder="Buteco do Zé"
            />
          </div>
          <DialogFooter>
            <Button
              onClick={() => createServer.mutate(serverName.trim())}
              disabled={!serverName.trim() || createServer.isPending}
            >
              {createServer.isPending ? "Criando..." : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-2xl tracking-wide">Puxar uma cadeira</DialogTitle>
            <DialogDescription>Cole o código que seu amigo mandou no grupo.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="invite">Código de convite</Label>
            <Input
              id="invite"
              value={inviteInput}
              onChange={(e) => setInviteInput(e.target.value)}
              placeholder="a1b2c3d4e5"
            />
          </div>
          <DialogFooter>
            <Button
              onClick={() => joinServer.mutate(inviteInput)}
              disabled={!inviteInput.trim() || joinServer.isPending}
            >
              {joinServer.isPending ? "Entrando..." : "Entrar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
