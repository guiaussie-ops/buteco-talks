import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useVoice } from "@/lib/voice";
import { useNaoLidas } from "@/hooks/useNaoLidas";
import { useButecoAoVivo } from "@/hooks/useButecoAoVivo";
import { MembrosDialog } from "@/components/app/MembrosDialog";
import { PESO, cargoDe } from "@/lib/cargos";
import type { Arrumacao, Categoria } from "@/lib/organizacao";
import type { ServerItem } from "@/components/app/Letreiro";
import { ChannelSidebar, type Channel } from "@/components/app/ChannelSidebar";
import { ChatPanel } from "@/components/app/ChatPanel";
import { VoicePanel } from "@/components/app/VoicePanel";
import { TelaCheia } from "@/components/app/TelaCheia";
import { NaTelaAgora, useTemTelaAgora } from "@/components/app/NaTelaAgora";
import { BarraDoCelular, Gaveta } from "@/components/app/Gaveta";
import { useIsMobile } from "@/hooks/use-mobile";
import { Salao } from "@/components/app/Salao";
import { PerfilDialog } from "@/components/app/PerfilDialog";
import { PerfilProvider } from "@/lib/perfil";
import { ConversasProvider } from "@/lib/conversas";
import { JanelasDeConversa } from "@/components/app/Conversas";
import { usePresencaNoBar } from "@/hooks/usePresencaNoBar";
import { prepararSons } from "@/lib/sons";
import { useMediaPrefs } from "@/lib/mediaPrefs";
import { statusDe } from "@/lib/status";
import { useVoiceRoster } from "@/hooks/useVoiceRoster";
import { ServerSettingsDialog } from "@/components/app/ServerSettingsDialog";
import { AccountSettingsDialog } from "@/components/app/AccountSettingsDialog";
import { Bottlecap } from "@/components/Bottlecap";
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
  const [accountOpen, setAccountOpen] = useState(false);
  const [membrosOpen, setMembrosOpen] = useState(false);
  /** No celular, qual gaveta está aberta: a das mesas, a das telas ou nenhuma. */
  const [gaveta, setGaveta] = useState<"mesas" | "telas" | null>(null);
  const celular = useIsMobile();
  const temTelas = useTemTelaAgora();
  // A última transmissão acabou com a gaveta das telas aberta: fecha, em vez
  // de deixar o fundo escuro cobrindo uma gaveta vazia.
  useEffect(() => {
    if (gaveta === "telas" && !temTelas) setGaveta(null);
  }, [gaveta, temTelas]);
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

  // O buteco aberto sumiu da minha lista: fui expulso, banido ou ele fechou.
  // Sai da tela dele, e da mesa de voz se eu estava sentado lá.
  useEffect(() => {
    if (!serversQuery.isSuccess || !activeServerId) return;
    if (servers.some((s) => s.id === activeServerId)) return;
    if (voice.active?.serverId === activeServerId) voice.leave();
    setActiveServerId(servers[0]?.id ?? null);
    setActiveChannel(null);
    toast.info("Você não está mais nesse buteco.");
  }, [serversQuery.isSuccess, servers, activeServerId, voice]);

  useButecoAoVivo(activeServerId, uid);

  const channelsQuery = useQuery({
    queryKey: ["channels", activeServerId],
    enabled: !!activeServerId,
    queryFn: async (): Promise<Channel[]> => {
      const { data, error } = await supabase
        .from("channels")
        .select("id, name, kind, server_id, category_id, position")
        .eq("server_id", activeServerId!)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Channel[];
    },
  });

  const channels = useMemo(() => channelsQuery.data ?? [], [channelsQuery.data]);

  const categoriasQuery = useQuery({
    queryKey: ["categorias", activeServerId],
    enabled: !!activeServerId,
    queryFn: async (): Promise<Categoria[]> => {
      const { data, error } = await supabase
        .from("channel_categories")
        .select("id, name, position")
        .eq("server_id", activeServerId!)
        .order("position", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
  const categorias = useMemo(() => categoriasQuery.data ?? [], [categoriasQuery.data]);

  // Quem está sentado em cada mesa de voz. Um só para a barra e o salão: dois
  // seriam duas assinaturas iguais do Realtime.
  const idsDeVoz = useMemo(
    () => channels.filter((c) => c.kind === "voice").map((c) => c.id),
    [channels],
  );
  const roster = useVoiceRoster(activeServerId, idsDeVoz, voice.active?.channelId ?? null);

  useEffect(() => {
    if (!activeServerId || !activeChannel) return;
    // Sem mesa aberta, a tela é o salão: é a porta de entrada do buteco. Cai
    // nele também quem estava numa mesa de outro buteco ou numa mesa que outra
    // pessoa apagou.
    const sumiu = channelsQuery.isSuccess && !channels.some((c) => c.id === activeChannel.id);
    if (activeChannel.server_id !== activeServerId || sumiu) setActiveChannel(null);
  }, [channels, channelsQuery.isSuccess, activeServerId, activeChannel]);

  // O objeto guardado em activeChannel envelhece quando alguém renomeia a mesa;
  // o nome que aparece vem sempre da lista atual.
  const canalAtivo = channels.find((c) => c.id === activeChannel?.id) ?? activeChannel;

  const membersQuery = useQuery({
    queryKey: ["members", activeServerId],
    enabled: !!activeServerId,
    queryFn: async (): Promise<{
      names: Record<string, string>;
      avatars: Record<string, string | null>;
      usernames: Record<string, string>;
      roles: Record<string, string>;
      subnicks: Record<string, string | null>;
    }> => {
      const { data: members, error } = await supabase
        .from("server_members")
        .select("user_id, role")
        .eq("server_id", activeServerId!);
      if (error) throw error;
      const ids = (members ?? []).map((m) => m.user_id);
      const roles = Object.fromEntries((members ?? []).map((m) => [m.user_id, m.role]));
      if (ids.length === 0) return { names: {}, avatars: {}, usernames: {}, roles, subnicks: {} };
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name, username, avatar_url, subnick")
        .in("id", ids);
      const names: Record<string, string> = {};
      const avatars: Record<string, string | null> = {};
      const usernames: Record<string, string> = {};
      const subnicks: Record<string, string | null> = {};
      (profiles ?? []).forEach((p) => {
        names[p.id] = p.display_name || p.username;
        avatars[p.id] = p.avatar_url;
        usernames[p.id] = p.username;
        subnicks[p.id] = p.subnick;
      });
      return { names, avatars, usernames, roles, subnicks };
    },
  });

  const names = membersQuery.data?.names ?? {};
  const avatars = membersQuery.data?.avatars ?? {};
  const usernames = membersQuery.data?.usernames ?? {};
  const roles = membersQuery.data?.roles ?? {};
  const subnicks = membersQuery.data?.subnicks ?? {};

  // Sons do bar: só com a preferência ligada, sem fone mudo e fora do
  // "ocupado" (no MSN, ocupado também calava os avisos).
  const { prefs } = useMediaPrefs();
  const comSom = prefs.sons && !voice.deafened && statusDe(profile?.status) !== "ocupado";
  useEffect(() => prepararSons(), []);

  // Quem está com o app aberto neste buteco agora: a lista de contatos online.
  const online = usePresencaNoBar({
    serverId: activeServerId,
    serverName: activeServer?.name ?? "buteco",
    meuId: uid,
    meuStatus: profile?.status ?? "tomando_uma",
    nomeDe: (id) => names[id] ?? "Alguém",
    comSom,
  });

  const naoLidas = useNaoLidas(
    activeServerId,
    uid,
    activeChannel?.kind === "text" ? activeChannel.id : null,
  );

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
      // Uma categoria só, com as duas mesas juntas. Categoria é assunto, não
      // tipo de mesa: o texto e a voz de um mesmo assunto moram lado a lado,
      // como no Discord. Nomes como "Mesas de texto" sugeriam uma separação
      // por tipo que o app não faz.
      const mesas = crypto.randomUUID();
      const { error: categoriaError } = await supabase
        .from("channel_categories")
        .insert({ id: mesas, server_id: serverId, name: "Mesas", position: 0 });
      if (categoriaError) throw categoriaError;
      const { error: channelError } = await supabase.from("channels").insert([
        { server_id: serverId, name: "geral", kind: "text", category_id: mesas, position: 0 },
        {
          server_id: serverId,
          name: "sala-de-tela",
          kind: "voice",
          category_id: mesas,
          position: 1,
        },
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
    // A RPC aceita o link inteiro colado e normaliza sozinha; não mexemos no texto aqui.
    mutationFn: async (code: string) => {
      const { data, error } = await supabase.rpc("join_server_by_code", { _code: code });
      if (error) throw error;
      return data as {
        status: "joined" | "already_member" | "not_found" | "expired" | "banned";
        server_id?: string;
      };
    },
    onSuccess: async (result) => {
      if (result.status === "not_found") {
        toast.error("Esse convite não existe ou já foi trocado. Peça um link novo.");
        return;
      }
      if (result.status === "expired") {
        toast.error("Esse convite venceu ou já foi usado o máximo de vezes. Peça um novo.");
        return;
      }
      if (result.status === "banned") {
        toast.error("Você foi banido desse buteco.");
        return;
      }
      await qc.invalidateQueries({ queryKey: ["servers", uid] });
      if (result.server_id) setActiveServerId(result.server_id);
      setActiveChannel(null);
      setJoinOpen(false);
      setInviteInput("");
      toast[result.status === "joined" ? "success" : "info"](
        result.status === "joined"
          ? "Você puxou a cadeira! Bem-vindo ao buteco."
          : "Você já está nesse buteco.",
      );
    },
    onError: () => toast.error("Não consegui abrir esse convite. Tenta de novo."),
  });

  const createChannel = async (name: string, kind: "text" | "voice", categoryId: string | null) => {
    // Entra no fim da categoria escolhida.
    const position = channels.reduce((max, c) => Math.max(max, c.position), -1) + 1;
    const { error } = await supabase
      .from("channels")
      .insert({ server_id: activeServerId!, name, kind, category_id: categoryId, position });
    if (error) {
      toast.error("Não consegui criar a mesa.");
      return;
    }
    await qc.invalidateQueries({ queryKey: ["channels", activeServerId] });
  };

  const meuCargo = activeServer
    ? cargoDe(activeServer.my_role, uid!, activeServer.owner_id)
    : "member";
  const canManage = !!activeServer && PESO[meuCargo] >= PESO.admin;
  const canModerate = !!activeServer && PESO[meuCargo] >= PESO.moderador;
  const isOwner = meuCargo === "owner";

  /**
   * Grava a arrumação nova das mesas. Aplica na tela antes, para o arrastar
   * não pular de volta enquanto o banco responde; se der erro, recarrega.
   */
  const organizar = async (arrumacao: Arrumacao) => {
    if (!activeServerId) return;
    const posMesa = new Map(arrumacao.mesas.map((m, i) => [m.id, { ...m, position: i }]));
    const posCategoria = new Map(arrumacao.categorias.map((id, i) => [id, i]));
    qc.setQueryData<Channel[]>(["channels", activeServerId], (prev) =>
      prev
        ?.map((c) => {
          const novo = posMesa.get(c.id);
          return novo ? { ...c, category_id: novo.category_id, position: novo.position } : c;
        })
        .sort((a, b) => a.position - b.position),
    );
    qc.setQueryData<Categoria[]>(["categorias", activeServerId], (prev) =>
      prev
        ?.map((k) => ({ ...k, position: posCategoria.get(k.id) ?? k.position }))
        .sort((a, b) => a.position - b.position),
    );
    const { error } = await supabase.rpc("organizar_mesas", {
      _server_id: activeServerId,
      _categorias: arrumacao.categorias,
      _mesas: arrumacao.mesas,
    });
    if (error) {
      toast.error("Não consegui arrumar as mesas.");
      await qc.invalidateQueries({ queryKey: ["channels", activeServerId] });
      await qc.invalidateQueries({ queryKey: ["categorias", activeServerId] });
    }
  };

  const criarCategoria = async (name: string) => {
    const position = categorias.reduce((max, k) => Math.max(max, k.position), -1) + 1;
    const { error } = await supabase
      .from("channel_categories")
      .insert({ server_id: activeServerId!, name, position });
    if (error) {
      toast.error("Não consegui criar a categoria.");
      return;
    }
    await qc.invalidateQueries({ queryKey: ["categorias", activeServerId] });
  };

  const renomearCategoria = async (id: string, name: string) => {
    const { error } = await supabase.from("channel_categories").update({ name }).eq("id", id);
    if (error) {
      toast.error("Não consegui renomear a categoria.");
      return;
    }
    await qc.invalidateQueries({ queryKey: ["categorias", activeServerId] });
  };

  const apagarCategoria = async (id: string) => {
    // As mesas dela ficam soltas (ON DELETE SET NULL), não somem.
    const { error } = await supabase.from("channel_categories").delete().eq("id", id);
    if (error) {
      toast.error("Não consegui apagar a categoria.");
      return;
    }
    await qc.invalidateQueries({ queryKey: ["categorias", activeServerId] });
    await qc.invalidateQueries({ queryKey: ["channels", activeServerId] });
  };

  const sairDoButeco = async () => {
    if (!activeServer || !uid) return;
    const { error } = await supabase
      .from("server_members")
      .delete()
      .eq("server_id", activeServer.id)
      .eq("user_id", uid);
    if (error) {
      toast.error("Não consegui sair do buteco.");
      return;
    }
    if (voice.active?.serverId === activeServer.id) voice.leave();
    setMembrosOpen(false);
    setActiveServerId(null);
    setActiveChannel(null);
    await qc.invalidateQueries({ queryKey: ["servers", uid] });
    toast.success(`Você saiu de ${activeServer.name}.`);
  };

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

  const regenerateInvite = async () => {
    if (!activeServer) return;
    const { data, error } = await supabase.rpc("regenerate_invite_code", {
      _server_id: activeServer.id,
    });
    if (error) {
      toast.error("Não consegui gerar um convite novo.");
      return;
    }
    await qc.invalidateQueries({ queryKey: ["servers", uid] });
    toast.success("Convite novo na área: " + data);
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

  const entrarNaMesa = (c: Channel) => {
    // Escolher uma mesa é querer vê-la: a tela cheia de uma transmissão volta
    // para a miniatura (o som continua).
    voice.sairDaTelaCheia();
    setGaveta(null);
    setActiveChannel(c);
    // Entrar na mesa de voz é uma acao explicita; mudar de canal de texto
    // depois disso nao derruba a conexao.
    if (c.kind === "voice" && activeServer) {
      voice.join({ channelId: c.id, channelName: c.name, serverId: activeServer.id });
    }
  };

  if (loading || !session || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground text-sm">Carregando...</p>
      </div>
    );
  }

  return (
    <PerfilProvider>
      <ConversasProvider meuId={uid!} nomeDe={(id) => names[id] ?? "Alguém"} comSom={comSom}>
        <div className="flex h-screen overflow-hidden">
          {activeServer ? (
            <>
              <Gaveta
                lado="esquerda"
                aberta={gaveta === "mesas"}
                onFechar={() => setGaveta(null)}
                rotulo="Mesas do buteco"
              >
                <ChannelSidebar
                  serverName={activeServer.name}
                  servers={servers}
                  onSelectServer={(id) => {
                    setActiveServerId(id);
                    setActiveChannel(null);
                    setGaveta(null);
                  }}
                  onCreateServer={() => setCreateOpen(true)}
                  onJoinServer={() => setJoinOpen(true)}
                  inviteCode={activeServer.invite_code}
                  channels={channels}
                  categorias={categorias}
                  onOrganizar={organizar}
                  onCriarCategoria={criarCategoria}
                  onRenomearCategoria={renomearCategoria}
                  onApagarCategoria={apagarCategoria}
                  onOpenMembros={() => setMembrosOpen(true)}
                  activeChannelId={activeChannel?.id ?? null}
                  onSelect={entrarNaMesa}
                  roster={roster}
                  onOpenSalao={() => {
                    voice.sairDaTelaCheia();
                    setGaveta(null);
                    setActiveChannel(null);
                  }}
                  isOwner={isOwner}
                  canManage={canManage}
                  onOpenSettings={() => setSettingsOpen(true)}
                  onRenameChannel={renameChannel}
                  onDeleteChannel={deleteChannel}
                  onRegenerateInvite={regenerateInvite}
                  avatars={avatars}
                  onCreateChannel={createChannel}
                  isAdult={isAdult}
                  onSignOut={() => void signOut()}
                  serverId={activeServer.id}
                  names={names}
                  naoLidas={naoLidas}
                  onOpenVoiceRoom={(channelId) => {
                    const c = channels.find((ch) => ch.id === channelId);
                    if (c) setActiveChannel(c);
                  }}
                />
              </Gaveta>
              <div className="flex min-w-0 flex-1 flex-col">
                {celular && (
                  <BarraDoCelular
                    titulo={activeServer.name}
                    temTelas={temTelas}
                    onAbrirMesas={() => setGaveta("mesas")}
                    onAbrirTelas={() => setGaveta("telas")}
                  />
                )}
                <div className="flex min-h-0 flex-1">
                  {/* A transmissão em tela cheia toma o centro de qualquer mesa; voltar
              pra miniatura devolve a mesa que estava aberta. */}
                  {voice.telaCheia ? (
                    <TelaCheia names={names} />
                  ) : activeChannel ? (
                    activeChannel.kind === "voice" ? (
                      <VoicePanel
                        key={activeChannel.id}
                        channelId={activeChannel.id}
                        channelName={canalAtivo?.name ?? activeChannel.name}
                        userId={uid!}
                        isAdult={isAdult}
                        names={names}
                        avatars={avatars}
                        onLeave={() => {
                          voice.leave();
                          setActiveChannel(null);
                        }}
                        onPuxarCadeira={() =>
                          voice.join({
                            channelId: activeChannel.id,
                            channelName: canalAtivo?.name ?? activeChannel.name,
                            serverId: activeServer.id,
                          })
                        }
                      />
                    ) : (
                      <ChatPanel
                        key={activeChannel.id}
                        channelId={activeChannel.id}
                        channelName={canalAtivo?.name ?? activeChannel.name}
                        serverId={activeServer.id}
                        userId={uid!}
                        names={names}
                        avatars={avatars}
                        usernames={usernames}
                        canModerate={canModerate}
                      />
                    )
                  ) : (
                    <Salao
                      channels={channels}
                      categorias={categorias}
                      roster={roster}
                      naoLidas={naoLidas}
                      names={names}
                      avatars={avatars}
                      onEntrar={entrarNaMesa}
                    />
                  )}
                </div>
              </div>
              <Gaveta
                lado="direita"
                aberta={gaveta === "telas"}
                onFechar={() => setGaveta(null)}
                rotulo="Transmissões"
              >
                <NaTelaAgora names={names} avatars={avatars} isAdult={isAdult} />
              </Gaveta>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
              <h1 className="font-display text-3xl tracking-wide">
                Você ainda não tem nenhum buteco
              </h1>
              <p className="text-muted-foreground max-w-sm text-sm">
                Abra o seu buteco e chame a galera, ou puxe uma cadeira usando o convite de um
                amigo.
              </p>
              <div className="flex gap-2">
                <Button onClick={() => setCreateOpen(true)}>Abrir um buteco</Button>
                <Button variant="outline" onClick={() => setJoinOpen(true)}>
                  Usar convite
                </Button>
              </div>

              {/*
            Sem buteco não há barra lateral, e é lá que mora o acesso ao perfil.
            Sem este atalho, quem acabou de criar a conta não consegue nem trocar
            o apelido antes de entrar no primeiro buteco.
          */}
              <button
                onClick={() => setAccountOpen(true)}
                title="Configurações da conta"
                className="border-border bg-surface/60 hover:border-primary/60 hover:bg-surface mt-6 flex items-center gap-2.5 rounded-full border py-1.5 pr-4 pl-1.5 transition-colors"
              >
                <Bottlecap
                  name={profile.display_name || profile.username}
                  src={profile.avatar_url}
                  className="size-7 text-xs"
                />
                <span className="text-sm">Ajeitar meu perfil</span>
              </button>
            </div>
          )}

          {activeServer && uid && (
            <MembrosDialog
              open={membrosOpen}
              onOpenChange={setMembrosOpen}
              serverId={activeServer.id}
              serverName={activeServer.name}
              ownerId={activeServer.owner_id}
              userId={uid}
              meuCargo={meuCargo}
              names={names}
              avatars={avatars}
              usernames={usernames}
              roles={roles}
              online={online}
              subnicks={subnicks}
              onSair={sairDoButeco}
            />
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

          <AccountSettingsDialog open={accountOpen} onOpenChange={setAccountOpen} />
          <PerfilDialog meuId={uid!} onEditarMeuPerfil={() => setAccountOpen(true)} />
          <JanelasDeConversa meuId={uid!} meuNome={profile.display_name || profile.username} />

          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-display text-2xl tracking-wide">
                  Abrir um buteco
                </DialogTitle>
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
                <DialogTitle className="font-display text-2xl tracking-wide">
                  Puxar uma cadeira
                </DialogTitle>
                <DialogDescription>
                  Cole o código ou o link que seu amigo mandou no grupo.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="invite">Código ou link de convite</Label>
                <Input
                  id="invite"
                  value={inviteInput}
                  onChange={(e) => setInviteInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && inviteInput.trim()) joinServer.mutate(inviteInput);
                  }}
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
      </ConversasProvider>
    </PerfilProvider>
  );
}
