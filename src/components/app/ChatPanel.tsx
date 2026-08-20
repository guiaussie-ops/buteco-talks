import { useEffect, useRef, useState } from "react";
import { Hash, SendHorizontal } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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

function initials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
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
      toast.error("Não consegui enviar a mensagem.");
      return;
    }
    setDraft("");
  };

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <header className="border-border flex h-14 shrink-0 items-center gap-2 border-b px-5">
        <Hash className="text-muted-foreground size-4" />
        <h1 className="font-display text-sm font-semibold">{channelName}</h1>
      </header>

      <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto px-5 py-6">
        {messages.length === 0 && (
          <p className="text-muted-foreground text-sm">
            Ninguém falou nada por aqui ainda. Manda a primeira mensagem.
          </p>
        )}
        {messages.map((m) => {
          const name = names[m.user_id] ?? "Alguém";
          return (
            <div key={m.id} className="flex gap-3">
              <Avatar className="mt-0.5 size-9 shrink-0">
                <AvatarFallback className="bg-surface-2 text-xs">{initials(name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold">{name}</span>
                  <span className="text-muted-foreground text-[11px]">{formatTime(m.created_at)}</span>
                </p>
                <p className="text-foreground/90 text-sm break-words whitespace-pre-wrap">{m.content}</p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="border-border shrink-0 border-t p-4">
        <div className="bg-surface flex items-end gap-2 rounded-xl p-2">
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
            placeholder={`Mensagem em #${channelName}`}
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
