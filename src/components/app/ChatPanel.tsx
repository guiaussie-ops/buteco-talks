import { useEffect, useRef, useState } from "react";
import { Hash, SendHorizontal } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Bottlecap } from "@/components/Bottlecap";
import { toast } from "sonner";

export type Message = {
  id: string;
  channel_id: string;
  user_id: string;
  content: string;
  created_at: string;
};

type Props = {
  channelId: string;
  channelName: string;
  userId: string;
  names: Record<string, string>;
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDay(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? "hoje"
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** Agrupa mensagens seguidas da mesma pessoa (janela de 5 min). */
function isGrouped(prev: Message | undefined, msg: Message) {
  if (!prev || prev.user_id !== msg.user_id) return false;
  return new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60 * 1000;
}

export function ChatPanel({ channelId, channelName, userId, names }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    void supabase
      .from("messages")
      .select("id, channel_id, user_id, content, created_at")
      .eq("channel_id", channelId)
      .order("created_at", { ascending: true })
      .limit(200)
      .then(({ data }) => {
        if (active) setMessages((data as Message[]) ?? []);
      });

    const channel = supabase
      .channel(`messages:${channelId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `channel_id=eq.${channelId}` },
        (payload) => {
          const msg = payload.new as Message;
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "messages", filter: `channel_id=eq.${channelId}` },
        (payload) => {
          const old = payload.old as { id: string };
          setMessages((prev) => prev.filter((m) => m.id !== old.id));
        },
      )
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [channelId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    const content = draft.trim();
    if (!content) return;
    setSending(true);
    const { error } = await supabase.from("messages").insert({ channel_id: channelId, user_id: userId, content });
    setSending(false);
    if (error) {
      toast.error("Não rolou mandar a resenha. Tenta de novo.");
      return;
    }
    setDraft("");
  };

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <header className="border-border flex h-14 shrink-0 items-center gap-2 border-b px-5">
        <Hash className="text-primary size-4" />
        <h1 className="font-display text-base tracking-wide">{channelName}</h1>
        <span className="text-muted-foreground ml-2 text-xs">mesa de texto</span>
      </header>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-6">
        {messages.length === 0 && (
          <div className="flex h-full min-h-60 flex-col items-center justify-center gap-2 text-center">
            <Bottlecap name={channelName} className="size-12" />
            <p className="text-muted-foreground max-w-xs text-sm">
              A mesa tá vazia... Solta a primeira resenha pra esquentar o ambiente.
            </p>
          </div>
        )}
        <div className="space-y-0.5">
          {messages.map((m, i) => {
            const name = names[m.user_id] ?? "Alguém";
            const grouped = isGrouped(messages[i - 1], m);
            if (grouped) {
              return (
                <div key={m.id} className="hover:bg-surface/50 group rounded-md py-0.5 pr-2 pl-[52px]">
                  <span className="text-muted-foreground mr-2 hidden w-8 text-right text-[10px] group-hover:inline-block">
                    {formatTime(m.created_at)}
                  </span>
                  <span className="text-foreground/90 text-sm break-words whitespace-pre-wrap">
                    {m.content}
                  </span>
                </div>
              );
            }
            return (
              <div key={m.id} className="mt-4 flex gap-3">
                <Bottlecap name={name} className="mt-0.5" />
                <div className="min-w-0">
                  <p className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold">{name}</span>
                    <span className="text-muted-foreground text-[11px]">
                      {formatDay(m.created_at)} às {formatTime(m.created_at)}
                    </span>
                  </p>
                  <p className="text-foreground/90 text-sm break-words whitespace-pre-wrap">{m.content}</p>
                </div>
              </div>
            );
          })}
        </div>
        <div ref={bottomRef} />
      </div>

      <div className="border-border shrink-0 border-t p-4">
        <div className="bg-surface wood-texture flex items-end gap-2 rounded-xl p-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder={`Solta a resenha em #${channelName}`}
            className="max-h-40 min-h-10 resize-none border-0 bg-transparent focus-visible:ring-0"
          />
          <Button size="icon" onClick={() => void send()} disabled={sending || !draft.trim()}>
            <SendHorizontal className="size-4" />
          </Button>
        </div>
      </div>
    </section>
  );
}
