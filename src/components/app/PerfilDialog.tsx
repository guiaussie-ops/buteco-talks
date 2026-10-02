import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, MessageCircle, Pencil, Smile, Snowflake, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePerfil } from "@/lib/perfil";
import { cn } from "@/lib/utils";
import { Bottlecap } from "@/components/Bottlecap";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

type Quesito = "confiavel" | "legal" | "sexy";

const QUESITOS: { id: Quesito; rotulo: string; Icone: typeof Smile; cor: string }[] = [
  { id: "confiavel", rotulo: "confiável", Icone: Smile, cor: "text-[oklch(0.55_0.12_75)]" },
  { id: "legal", rotulo: "legal", Icone: Snowflake, cor: "text-[oklch(0.55_0.12_250)]" },
  { id: "sexy", rotulo: "sexy", Icone: Heart, cor: "text-[oklch(0.55_0.17_25)]" },
];

type Recado = {
  id: string;
  texto: string;
  created_at: string;
  de_id: string;
  autor: { display_name: string; username: string; avatar_url: string | null } | null;
};

function quando(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * O perfil de alguém, à moda do Orkut: foto e quem é à esquerda, os butecos
 * que vocês frequentam juntos, as notas de confiável / legal / sexy e o mural
 * de recados. Só abre para quem divide pelo menos um buteco com a pessoa — é
 * a mesma regra do banco.
 */
export function PerfilDialog({
  meuId,
  onEditarMeuPerfil,
  onConversar,
}: {
  meuId: string;
  onEditarMeuPerfil: () => void;
  /** Abre a conversa privada (janela do MSN) com a pessoa. */
  onConversar?: (userId: string) => void;
}) {
  const { aberto, fecharPerfil } = usePerfil();
  const id = aberto;
  const souEu = id === meuId;
  const qc = useQueryClient();
  const [rascunho, setRascunho] = useState("");

  const perfil = useQuery({
    queryKey: ["perfil", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, username, avatar_url, bio, created_at")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const emComum = useQuery({
    queryKey: ["em-comum", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("butecos_em_comum", { _user_id: id! });
      if (error) throw error;
      return data ?? [];
    },
  });

  const notas = useQuery({
    queryKey: ["notas", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("notas_do_perfil", { _user_id: id! });
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((n) => [n.quesito, n])) as Record<
        string,
        { media: number; votos: number }
      >;
    },
  });

  const meusVotos = useQuery({
    queryKey: ["meus-votos", id],
    enabled: !!id && !souEu,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("votos_de_perfil")
        .select("quesito, nivel")
        .eq("para_id", id!)
        .eq("de_id", meuId);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((v) => [v.quesito, v.nivel])) as Record<
        string,
        number
      >;
    },
  });

  const recados = useQuery({
    queryKey: ["recados", id],
    enabled: !!id,
    queryFn: async (): Promise<Recado[]> => {
      const { data, error } = await supabase
        .from("recados")
        .select(
          "id, texto, created_at, de_id, autor:profiles!recados_de_id_fkey(display_name, username, avatar_url)",
        )
        .eq("para_id", id!)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as unknown as Recado[];
    },
  });

  const votar = useMutation({
    mutationFn: async ({ quesito, nivel }: { quesito: Quesito; nivel: number }) => {
      // Clicar no mesmo nível de novo tira o voto.
      if (meusVotos.data?.[quesito] === nivel) {
        const { error } = await supabase
          .from("votos_de_perfil")
          .delete()
          .match({ de_id: meuId, para_id: id!, quesito });
        if (error) throw error;
        return;
      }
      // Sem upsert: ele reescreveria a linha inteira, e o banco só deixa mudar
      // o nível de um voto que já existe.
      const { error } = meusVotos.data?.[quesito]
        ? await supabase
            .from("votos_de_perfil")
            .update({ nivel, updated_at: new Date().toISOString() })
            .match({ de_id: meuId, para_id: id!, quesito })
        : await supabase
            .from("votos_de_perfil")
            .insert({ de_id: meuId, para_id: id!, quesito, nivel });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["meus-votos", id] });
      await qc.invalidateQueries({ queryKey: ["notas", id] });
    },
    onError: () => toast.error("Não consegui registrar o voto."),
  });

  const mandarRecado = useMutation({
    mutationFn: async (texto: string) => {
      const { error } = await supabase
        .from("recados")
        .insert({ para_id: id!, de_id: meuId, texto });
      if (error) throw error;
    },
    onSuccess: async () => {
      setRascunho("");
      await qc.invalidateQueries({ queryKey: ["recados", id] });
    },
    onError: () => toast.error("O recado não foi. Tenta de novo."),
  });

  const apagarRecado = useMutation({
    mutationFn: async (recadoId: string) => {
      const { error } = await supabase.from("recados").delete().eq("id", recadoId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recados", id] }),
    onError: () => toast.error("Não consegui apagar o recado."),
  });

  const p = perfil.data;
  const nome = p?.display_name || p?.username || "…";
  const lista = recados.data ?? [];

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && fecharPerfil()}>
      <DialogContent className="bg-papel text-papel-tinta border-papel-linha scrollbar-thin max-h-[90vh] overflow-y-auto p-0 sm:max-w-3xl [&>button]:text-papel-tinta">
        <div className="bg-mesa-borda text-papel flex items-center gap-2 rounded-t-lg px-5 py-2.5">
          <span className="font-display text-2xl tracking-wide">perfil</span>
          <span className="text-papel/70 text-xs">no buteco</span>
        </div>

        {perfil.isSuccess && !p ? (
          <p className="p-6 text-sm">Esse perfil não está disponível pra você.</p>
        ) : (
          <div className="grid gap-5 p-5 sm:grid-cols-[200px_minmax(0,1fr)]">
            {/* ===== quem é ===== */}
            <aside className="flex flex-col gap-3">
              <div className="bg-papel-linha/40 flex aspect-square items-center justify-center rounded-lg">
                <Bottlecap name={nome} src={p?.avatar_url} className="size-32 text-5xl" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">{nome}</DialogTitle>
                <DialogDescription className="text-papel-tinta/70 text-xs">
                  @{p?.username}
                </DialogDescription>
              </div>
              {p?.bio && <p className="text-sm leading-relaxed whitespace-pre-wrap">{p.bio}</p>}
              {(emComum.data?.length ?? 0) > 0 && (
                <div className="text-sm">
                  <p className="text-papel-tinta/70 text-xs">frequenta:</p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {emComum.data!.map((b) => (
                      <li key={b.server_id} className="flex items-center gap-1.5">
                        <span className="bg-papel-linha/50 flex size-5 items-center justify-center rounded text-xs">
                          {b.icon_emoji || b.name.slice(0, 1)}
                        </span>
                        <span className="truncate font-medium">{b.name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {souEu ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-papel-linha text-papel-tinta bg-transparent"
                  onClick={() => {
                    fecharPerfil();
                    onEditarMeuPerfil();
                  }}
                >
                  <Pencil className="size-4" /> Editar meu perfil
                </Button>
              ) : (
                onConversar && (
                  <Button
                    size="sm"
                    onClick={() => {
                      fecharPerfil();
                      onConversar(id!);
                    }}
                  >
                    <MessageCircle className="size-4" /> Conversar
                  </Button>
                )
              )}
            </aside>

            <div className="flex min-w-0 flex-col gap-5">
              {/* ===== notas ===== */}
              <section className="border-papel-linha rounded-lg border">
                <h3 className="bg-papel-linha/40 rounded-t-lg px-3 py-1.5 text-sm font-bold">
                  {souEu ? "o que a galera acha de você" : `o que a galera acha de ${nome}`}
                </h3>
                <div className="flex flex-col gap-2 p-3">
                  {QUESITOS.map(({ id: q, rotulo, Icone, cor }) => {
                    const nota = notas.data?.[q];
                    const media = Math.round(nota?.media ?? 0);
                    const meu = meusVotos.data?.[q] ?? 0;
                    return (
                      <div key={q} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                        <span className="w-20">{rotulo}</span>
                        <span
                          className="flex gap-0.5"
                          aria-label={`${rotulo}: média ${nota?.media ?? 0} de 3`}
                        >
                          {[1, 2, 3].map((n) => (
                            <Icone
                              key={n}
                              className={cn("size-4", n <= media ? cor : "text-papel-tinta/20")}
                              fill={n <= media ? "currentColor" : "none"}
                            />
                          ))}
                        </span>
                        <span className="text-papel-tinta/60 text-xs">
                          {nota?.votos ?? 0} {nota?.votos === 1 ? "voto" : "votos"}
                        </span>
                        {!souEu && (
                          <span className="ml-auto flex items-center gap-1 text-xs">
                            <span className="text-papel-tinta/60 mr-1">seu voto:</span>
                            {[1, 2, 3].map((n) => (
                              <button
                                key={n}
                                type="button"
                                disabled={votar.isPending}
                                onClick={() => votar.mutate({ quesito: q, nivel: n })}
                                aria-label={`Dar ${n} em ${rotulo}`}
                                aria-pressed={meu >= n}
                                className="rounded p-0.5 hover:bg-black/5 disabled:opacity-50"
                              >
                                <Icone
                                  className={cn("size-4", n <= meu ? cor : "text-papel-tinta/30")}
                                  fill={n <= meu ? "currentColor" : "none"}
                                />
                              </button>
                            ))}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {!souEu && (
                    <p className="text-papel-tinta/60 text-[11px]">
                      O voto é secreto: ninguém vê quem votou o quê, só a média.
                    </p>
                  )}
                </div>
              </section>

              {/* ===== recados ===== */}
              <section className="border-papel-linha rounded-lg border">
                <h3 className="bg-papel-linha/40 rounded-t-lg px-3 py-1.5 text-sm font-bold">
                  recados ({lista.length >= 30 ? "30+" : lista.length})
                </h3>
                {!souEu && (
                  <form
                    className="border-papel-linha flex flex-col gap-2 border-b p-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const texto = rascunho.trim();
                      if (texto) mandarRecado.mutate(texto);
                    }}
                  >
                    <label htmlFor="recado" className="sr-only">
                      Recado para {nome}
                    </label>
                    <Textarea
                      id="recado"
                      value={rascunho}
                      onChange={(e) => setRascunho(e.target.value)}
                      maxLength={1000}
                      placeholder={`Deixa um recado pra ${nome}…`}
                      className="border-papel-linha min-h-16 resize-none bg-white/60 text-sm"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      className="self-end"
                      disabled={!rascunho.trim() || mandarRecado.isPending}
                    >
                      {mandarRecado.isPending ? "Mandando..." : "Mandar recado"}
                    </Button>
                  </form>
                )}
                <ul className="flex flex-col">
                  {lista.length === 0 && (
                    <li className="text-papel-tinta/60 p-4 text-center text-sm">
                      {souEu
                        ? "Seu mural ainda está vazio."
                        : "Ninguém deixou recado ainda. Seja o primeiro!"}
                    </li>
                  )}
                  {lista.map((r) => {
                    const autor = r.autor?.display_name || r.autor?.username || "Alguém";
                    const podeApagar = r.de_id === meuId || souEu;
                    return (
                      <li
                        key={r.id}
                        className="border-papel-linha/60 flex gap-3 border-b p-3 last:border-b-0"
                      >
                        <Bottlecap name={autor} src={r.autor?.avatar_url} className="size-9" />
                        <div className="min-w-0 flex-1 text-sm">
                          <p>
                            <b>{autor}</b>{" "}
                            <span className="text-papel-tinta/60 text-xs">
                              {quando(r.created_at)}
                            </span>
                          </p>
                          <p className="break-words whitespace-pre-wrap">{r.texto}</p>
                        </div>
                        {podeApagar && (
                          <button
                            type="button"
                            onClick={() => apagarRecado.mutate(r.id)}
                            aria-label="Apagar recado"
                            className="text-papel-tinta/50 hover:text-destructive self-start rounded p-1"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
