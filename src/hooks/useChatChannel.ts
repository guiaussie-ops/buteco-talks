import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { MESSAGE_COLUMNS, caminhoDaImagem, depoisDe, type Message, type Reacao } from "@/lib/chat";
import { zerarNaoLidas } from "@/hooks/useNaoLidas";

const PAGINA = 100;
/** Quanto tempo o "digitando…" vale sem um aviso novo. */
const DIGITANDO_VALE_MS = 4000;
/** De quanto em quanto tempo eu reaviso que continuo digitando. */
const DIGITANDO_REAVISO_MS = 2500;
/** As URLs assinadas duram mais que qualquer sessão razoável numa mesa. */
const URL_DURA_S = 6 * 60 * 60;

type Opcoes = { channelId: string; serverId: string; userId: string };

/**
 * Tudo que uma mesa de texto precisa saber do banco: mensagens (com paginação
 * para trás), reações, as mensagens citadas que não estão carregadas, as URLs
 * assinadas das imagens, quem está digitando e onde fica a linha de "novas".
 */
export function useChatChannel({ channelId, serverId, userId }: Opcoes) {
  const qc = useQueryClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [temMais, setTemMais] = useState(false);
  const [reacoes, setReacoes] = useState<Reacao[]>([]);
  const [citadas, setCitadas] = useState<Record<string, Message>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [digitando, setDigitando] = useState<Record<string, number>>({});
  /**
   * Mensagens dos outros depois deste instante ficam abaixo da linha "novas
   * mensagens". Nasce do que estava marcado como lido ao abrir a mesa.
   */
  const [limiar, setLimiar] = useState<string | null>(null);

  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  const limiarRef = useRef<string | null>(null);
  limiarRef.current = limiar;
  const canalRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const ultimoAvisoRef = useRef(0);
  const pedindoUrlsRef = useRef(new Set<string>());

  // -------------------------------------------------------------------------
  // Leitura
  // -------------------------------------------------------------------------

  const marcarLida = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    zerarNaoLidas(qc, serverId, channelId);
    void supabase.rpc("marcar_lida", { _channel_id: channelId });
  }, [qc, serverId, channelId]);

  /** Busca as citações que apontam para fora do que está carregado. */
  const buscarCitadas = useCallback(async (lista: Message[]) => {
    const presentes = new Set(messagesRef.current.map((m) => m.id));
    lista.forEach((m) => presentes.add(m.id));
    const faltam = [
      ...new Set(
        lista.map((m) => m.reply_to).filter((id): id is string => !!id && !presentes.has(id)),
      ),
    ];
    if (faltam.length === 0) return;
    const { data } = await supabase.from("messages").select(MESSAGE_COLUMNS).in("id", faltam);
    if (data) {
      setCitadas((prev) => {
        const novo = { ...prev };
        (data as Message[]).forEach((m) => (novo[m.id] = m));
        return novo;
      });
    }
  }, []);

  const buscarReacoes = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const { data } = await supabase
      .from("message_reactions")
      .select("message_id, user_id, emoji")
      .in("message_id", ids)
      .order("created_at", { ascending: true });
    if (data) {
      const novas = data as Reacao[];
      setReacoes((prev) => {
        const de = new Set(ids);
        return [...prev.filter((r) => !de.has(r.message_id)), ...novas];
      });
    }
  }, []);

  const assinarImagens = useCallback(async (lista: Message[]) => {
    const caminhos = lista
      .map((m) => m.image_path)
      .filter((p): p is string => !!p && !pedindoUrlsRef.current.has(p));
    if (caminhos.length === 0) return;
    caminhos.forEach((p) => pedindoUrlsRef.current.add(p));
    const { data } = await supabase.storage
      .from("chat-images")
      .createSignedUrls(caminhos, URL_DURA_S);
    if (!data) return;
    setUrls((prev) => {
      const novo = { ...prev };
      data.forEach((d) => {
        if (d.path && d.signedUrl) novo[d.path] = d.signedUrl;
      });
      return novo;
    });
  }, []);

  /** Tudo que uma leva de mensagens recém-chegada puxa junto. */
  const complementar = useCallback(
    (lista: Message[]) => {
      void buscarCitadas(lista);
      void buscarReacoes(lista.map((m) => m.id));
      void assinarImagens(lista);
    },
    [buscarCitadas, buscarReacoes, assinarImagens],
  );

  const chegou = useCallback(
    (msg: Message) => {
      if (messagesRef.current.some((m) => m.id === msg.id)) return;
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      void buscarCitadas([msg]);
      void assinarImagens([msg]);
      if (msg.user_id !== userId) {
        setDigitando((prev) => {
          if (!(msg.user_id in prev)) return prev;
          const { [msg.user_id]: _, ...resto } = prev;
          return resto;
        });
        // Com a aba à vista e nada pendente abaixo da linha, quem está lendo ao
        // vivo não precisa de linha nenhuma: ela anda junto com a conversa.
        const visivel = document.visibilityState === "visible";
        const pendentes = messagesRef.current.some((m) => depoisDe(m, limiarRef.current, userId));
        if (visivel && !pendentes) setLimiar(msg.created_at);
        marcarLida();
      }
    },
    [userId, buscarCitadas, assinarImagens, marcarLida],
  );

  useEffect(() => {
    let ativo = true;

    void (async () => {
      const [{ data: lida }, { data }] = await Promise.all([
        supabase
          .from("channel_reads")
          .select("last_read_at")
          .eq("channel_id", channelId)
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("messages")
          .select(MESSAGE_COLUMNS)
          .eq("channel_id", channelId)
          .order("created_at", { ascending: false })
          .limit(PAGINA),
      ]);
      if (!ativo) return;
      const lista = ((data as Message[]) ?? []).reverse();
      // Sem linha em channel_reads, é a primeira visita: tudo conta como lido.
      setLimiar(lida?.last_read_at ?? new Date().toISOString());
      setMessages(lista);
      setTemMais((data?.length ?? 0) === PAGINA);
      setCarregado(true);
      complementar(lista);
      marcarLida();
    })();

    const canal = supabase
      .channel(`chat:${channelId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => chegou(payload.new as Message),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          const msg = payload.new as Message;
          setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));
          setCitadas((prev) => (msg.id in prev ? { ...prev, [msg.id]: msg } : prev));
        },
      )
      // DELETE não aceita filtro no Realtime: chega de todas as mesas, só com a
      // chave. Quem não está na lista simplesmente não muda nada.
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "messages" },
        (payload) => {
          const id = (payload.old as { id: string }).id;
          setMessages((prev) => prev.filter((m) => m.id !== id));
          setCitadas((prev) => {
            if (!(id in prev)) return prev;
            const { [id]: _, ...resto } = prev;
            return resto;
          });
          setReacoes((prev) => prev.filter((r) => r.message_id !== id));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "message_reactions",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          const r = payload.new as Reacao;
          setReacoes((prev) =>
            prev.some(
              (x) =>
                x.message_id === r.message_id && x.user_id === r.user_id && x.emoji === r.emoji,
            )
              ? prev
              : [...prev, { message_id: r.message_id, user_id: r.user_id, emoji: r.emoji }],
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "message_reactions" },
        (payload) => {
          const r = payload.old as Reacao;
          setReacoes((prev) =>
            prev.filter(
              (x) =>
                !(x.message_id === r.message_id && x.user_id === r.user_id && x.emoji === r.emoji),
            ),
          );
        },
      )
      .on("broadcast", { event: "digitando" }, ({ payload }) => {
        const quem = (payload as { user_id?: string }).user_id;
        if (!quem || quem === userId) return;
        setDigitando((prev) => ({ ...prev, [quem]: Date.now() + DIGITANDO_VALE_MS }));
      })
      .on("broadcast", { event: "parou" }, ({ payload }) => {
        const quem = (payload as { user_id?: string }).user_id;
        if (!quem) return;
        setDigitando((prev) => {
          if (!(quem in prev)) return prev;
          const { [quem]: _, ...resto } = prev;
          return resto;
        });
      })
      .subscribe();
    canalRef.current = canal;

    // Quem volta para a aba lê o que chegou enquanto estava fora.
    const aoVoltar = () => {
      if (document.visibilityState === "visible") marcarLida();
    };
    document.addEventListener("visibilitychange", aoVoltar);

    return () => {
      ativo = false;
      canalRef.current = null;
      document.removeEventListener("visibilitychange", aoVoltar);
      void supabase.removeChannel(canal);
    };
    // chegou/complementar/marcarLida mudam junto com channelId e userId, que
    // já estão aqui; o efeito só deve refazer a assinatura ao trocar de mesa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, userId]);

  // "digitando…" expira sozinho quando o aviso para de chegar.
  useEffect(() => {
    if (Object.keys(digitando).length === 0) return;
    const t = window.setInterval(() => {
      const agora = Date.now();
      setDigitando((prev) => {
        const vivos = Object.entries(prev).filter(([, ate]) => ate > agora);
        return vivos.length === Object.keys(prev).length ? prev : Object.fromEntries(vivos);
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [digitando]);

  const carregarAntigas = useCallback(async () => {
    const primeira = messagesRef.current[0];
    if (!primeira) return 0;
    const { data } = await supabase
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("channel_id", channelId)
      .lt("created_at", primeira.created_at)
      .order("created_at", { ascending: false })
      .limit(PAGINA);
    const lista = ((data as Message[]) ?? []).reverse();
    setTemMais((data?.length ?? 0) === PAGINA);
    if (lista.length === 0) return 0;
    setMessages((prev) => [...lista, ...prev]);
    complementar(lista);
    return lista.length;
  }, [channelId, complementar]);

  // -------------------------------------------------------------------------
  // Escrita
  // -------------------------------------------------------------------------

  const avisarDigitando = useCallback(() => {
    const agora = Date.now();
    if (agora - ultimoAvisoRef.current < DIGITANDO_REAVISO_MS) return;
    ultimoAvisoRef.current = agora;
    void canalRef.current?.send({
      type: "broadcast",
      event: "digitando",
      payload: { user_id: userId },
    });
  }, [userId]);

  const pararDeDigitar = useCallback(() => {
    if (ultimoAvisoRef.current === 0) return;
    ultimoAvisoRef.current = 0;
    void canalRef.current?.send({
      type: "broadcast",
      event: "parou",
      payload: { user_id: userId },
    });
  }, [userId]);

  const enviar = useCallback(
    async ({
      texto,
      replyTo,
      imagem,
    }: {
      texto: string;
      replyTo: string | null;
      imagem: File | null;
    }) => {
      let image_path: string | null = null;
      if (imagem) {
        image_path = caminhoDaImagem(channelId, userId, imagem.type);
        const { error } = await supabase.storage
          .from("chat-images")
          .upload(image_path, imagem, { contentType: imagem.type });
        if (error) {
          toast.error("A imagem não subiu. Tenta de novo.");
          return false;
        }
      }
      const { data, error } = await supabase
        .from("messages")
        .insert({
          channel_id: channelId,
          user_id: userId,
          content: texto,
          reply_to: replyTo,
          image_path,
        })
        .select(MESSAGE_COLUMNS)
        .single();
      if (error) {
        if (image_path) void supabase.storage.from("chat-images").remove([image_path]);
        toast.error("Não rolou mandar a resenha. Tenta de novo.");
        return false;
      }
      pararDeDigitar();
      // Quem fala já leu tudo que veio antes: a linha de "novas" sai.
      setLimiar(new Date().toISOString());
      // Não espera o Realtime para a própria mensagem aparecer.
      chegou(data as Message);
      marcarLida();
      return true;
    },
    [channelId, userId, chegou, pararDeDigitar, marcarLida],
  );

  const editar = useCallback(async (id: string, texto: string) => {
    const { data, error } = await supabase
      .from("messages")
      .update({ content: texto })
      .eq("id", id)
      .select(MESSAGE_COLUMNS)
      .single();
    if (error) {
      toast.error("Não consegui editar a mensagem.");
      return false;
    }
    const msg = data as Message;
    setMessages((prev) => prev.map((m) => (m.id === id ? msg : m)));
    return true;
  }, []);

  const apagar = useCallback(async (msg: Message) => {
    const { error } = await supabase.from("messages").delete().eq("id", msg.id);
    if (error) {
      toast.error("Não consegui apagar a mensagem.");
      return;
    }
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
    setReacoes((prev) => prev.filter((r) => r.message_id !== msg.id));
    if (msg.image_path) void supabase.storage.from("chat-images").remove([msg.image_path]);
  }, []);

  const alternarReacao = useCallback(
    async (messageId: string, emoji: string) => {
      const minha = reacoes.some(
        (r) => r.message_id === messageId && r.user_id === userId && r.emoji === emoji,
      );
      const eq = (r: Reacao) =>
        r.message_id === messageId && r.user_id === userId && r.emoji === emoji;
      // Otimista: o clique responde na hora, e volta atrás se o banco recusar.
      if (minha) {
        setReacoes((prev) => prev.filter((r) => !eq(r)));
        const { error } = await supabase
          .from("message_reactions")
          .delete()
          .match({ message_id: messageId, user_id: userId, emoji });
        if (error) {
          setReacoes((prev) => [...prev, { message_id: messageId, user_id: userId, emoji }]);
          toast.error("Não consegui tirar a reação.");
        }
      } else {
        setReacoes((prev) => [...prev, { message_id: messageId, user_id: userId, emoji }]);
        const { error } = await supabase
          .from("message_reactions")
          // channel_id é sobrescrito pelo banco a partir da mensagem.
          .insert({ message_id: messageId, user_id: userId, emoji, channel_id: channelId });
        if (error) {
          setReacoes((prev) => prev.filter((r) => !eq(r)));
          toast.error("Não consegui reagir.");
        }
      }
    },
    [reacoes, userId, channelId],
  );

  return {
    messages,
    carregado,
    temMais,
    carregarAntigas,
    reacoes,
    citadas,
    urls,
    digitando: Object.keys(digitando),
    limiar,
    avisarDigitando,
    pararDeDigitar,
    enviar,
    editar,
    apagar,
    alternarReacao,
  };
}
