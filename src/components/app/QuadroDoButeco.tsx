import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Megaphone, Pencil, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LIMITE, QUADRO_VAZIO, quadroEmBranco, regrasDoTexto, type Quadro } from "@/lib/quadro";
import { cn } from "@/lib/utils";

/**
 * O quadro na parede do salão: o recado de boas-vindas, as regras da casa e o
 * aviso do dono. Fica em cima das mesas, que é o primeiro lugar que se olha ao
 * entrar. Quem cuida do buteco escreve por aqui mesmo; os outros só leem, e
 * veem a mudança na hora (useButecoAoVivo recarrega a query).
 */
export function QuadroDoButeco({
  serverId,
  podeEditar,
}: {
  serverId: string;
  podeEditar: boolean;
}) {
  const [editando, setEditando] = useState(false);
  const { data: quadro = QUADRO_VAZIO, isSuccess } = useQuery({
    queryKey: ["quadro", serverId],
    queryFn: async (): Promise<Quadro> => {
      const { data, error } = await supabase
        .from("quadro_do_buteco")
        .select("boas_vindas, regras, aviso")
        .eq("server_id", serverId)
        .maybeSingle();
      if (error) throw error;
      return data ?? QUADRO_VAZIO;
    },
  });

  if (!isSuccess) return null;
  const regras = regrasDoTexto(quadro.regras);
  const emBranco = quadroEmBranco(quadro);
  if (emBranco && !podeEditar) return null;

  return (
    <>
      {emBranco ? (
        // Quadro vazio é recado só para quem cuida do buteco: uma ficha pequena, que
        // não disputa o salão com as mesas.
        <button
          onClick={() => setEditando(true)}
          title="Escreva as boas-vindas, as regras da casa e um aviso para quem chegar no salão."
          className="border-papel-linha/30 text-muted-foreground hover:border-primary/60 hover:text-foreground inline-flex h-8 items-center gap-1.5 rounded-full border border-dashed bg-black/30 px-3 text-xs font-medium transition-colors"
        >
          <Pencil className="size-3.5" /> Escrever o quadro
        </button>
      ) : (
        <article className="bg-papel text-papel-tinta relative w-full max-w-2xl rounded-lg shadow-[0_10px_24px_rgb(0_0_0/0.45)]">
          {quadro.aviso.trim() && (
            <p className="bg-neon text-neon-foreground flex items-start gap-2 rounded-t-lg px-5 py-2.5 text-sm font-medium">
              <Megaphone className="mt-0.5 size-4 shrink-0" />
              <span className="whitespace-pre-line">{quadro.aviso}</span>
            </p>
          )}
          <div className="flex flex-col gap-4 px-5 py-4 sm:px-6">
            <div className="flex items-start gap-3">
              <h2 className="font-display flex-1 text-2xl tracking-wide">Quadro do buteco</h2>
              {podeEditar && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditando(true)}
                  className="text-papel-tinta hover:bg-papel-linha/40 hover:text-papel-tinta -mr-2 h-8"
                >
                  <Pencil className="size-3.5" /> Editar
                </Button>
              )}
            </div>
            {quadro.boas_vindas.trim() && (
              <p className="text-sm leading-relaxed whitespace-pre-line">{quadro.boas_vindas}</p>
            )}
            {regras.length > 0 && (
              <section>
                <h3 className="font-display text-lg tracking-[0.12em] uppercase">Regras da casa</h3>
                <ol className="border-papel-linha mt-1 flex list-inside list-decimal flex-col gap-1 border-t border-dotted pt-2 text-sm">
                  {regras.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ol>
              </section>
            )}
          </div>
        </article>
      )}
      {podeEditar && (
        <EditorDoQuadro
          open={editando}
          onOpenChange={setEditando}
          serverId={serverId}
          atual={quadro}
        />
      )}
    </>
  );
}

const CAMPOS: { campo: keyof Quadro; rotulo: string; dica: string; linhas: number }[] = [
  {
    campo: "aviso",
    rotulo: "Aviso",
    dica: "Fica em destaque no topo. Ex.: Sexta tem jogo na mesa de voz às 21h.",
    linhas: 2,
  },
  {
    campo: "boas_vindas",
    rotulo: "Boas-vindas",
    dica: "O recado para quem chega.",
    linhas: 3,
  },
  {
    campo: "regras",
    rotulo: "Regras da casa",
    dica: "Uma regra por linha. O quadro numera sozinho.",
    linhas: 6,
  },
];

function EditorDoQuadro({
  open,
  onOpenChange,
  serverId,
  atual,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverId: string;
  atual: Quadro;
}) {
  const qc = useQueryClient();
  const [texto, setTexto] = useState<Quadro>(atual);
  const [salvando, setSalvando] = useState(false);

  // Reabrir o editor volta ao que está no quadro agora.
  useEffect(() => {
    if (open) setTexto(atual);
  }, [open, atual]);

  const mudou = CAMPOS.some(({ campo }) => texto[campo].trim() !== atual[campo].trim());
  const estourou = CAMPOS.some(({ campo }) => texto[campo].length > LIMITE[campo]);

  const salvar = async () => {
    setSalvando(true);
    const { error } = await supabase.rpc("salvar_quadro", {
      _server_id: serverId,
      _boas_vindas: texto.boas_vindas,
      _regras: texto.regras,
      _aviso: texto.aviso,
    });
    setSalvando(false);
    if (error) {
      toast.error("Não consegui salvar o quadro.");
      return;
    }
    await qc.invalidateQueries({ queryKey: ["quadro", serverId] });
    toast.success("Quadro atualizado.");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="wood-texture scrollbar-thin max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl tracking-wide">
            Quadro do buteco
          </DialogTitle>
          <DialogDescription>
            Todo mundo do buteco vê o quadro no salão. Deixe em branco o que não quiser mostrar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {CAMPOS.map(({ campo, rotulo, dica, linhas }) => {
            const tamanho = texto[campo].length;
            return (
              <div key={campo} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <Label htmlFor={`quadro-${campo}`}>{rotulo}</Label>
                  <span
                    className={cn(
                      "text-xs tabular-nums",
                      tamanho > LIMITE[campo] ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {tamanho}/{LIMITE[campo]}
                  </span>
                </div>
                <Textarea
                  id={`quadro-${campo}`}
                  rows={linhas}
                  value={texto[campo]}
                  onChange={(e) => setTexto((t) => ({ ...t, [campo]: e.target.value }))}
                />
                <p className="text-muted-foreground text-xs">{dica}</p>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button onClick={() => void salvar()} disabled={!mudou || estourou || salvando}>
            <Save className="size-4" /> {salvando ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
