import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/** Validade em minutos; null = não vence. Mesmas opções do Discord. */
const VALIDADES: { rotulo: string; minutos: number | null }[] = [
  { rotulo: "30 minutos", minutos: 30 },
  { rotulo: "1 hora", minutos: 60 },
  { rotulo: "6 horas", minutos: 6 * 60 },
  { rotulo: "12 horas", minutos: 12 * 60 },
  { rotulo: "1 dia", minutos: 24 * 60 },
  { rotulo: "7 dias", minutos: 7 * 24 * 60 },
  { rotulo: "Nunca", minutos: null },
];

const USOS: { rotulo: string; max: number | null }[] = [
  { rotulo: "Sem limite", max: null },
  { rotulo: "1 uso", max: 1 },
  { rotulo: "5 usos", max: 5 },
  { rotulo: "10 usos", max: 10 },
  { rotulo: "25 usos", max: 25 },
  { rotulo: "50 usos", max: 50 },
  { rotulo: "100 usos", max: 100 },
];

type Convite = {
  code: string;
  created_at: string;
  expires_at: string | null;
  max_uses: number | null;
  uses: number;
};

/** "vence em 3 h", "vence em 2 dias", "venceu". */
function prazo(expiresAt: string | null, agora = Date.now()) {
  if (!expiresAt) return "não vence";
  const falta = new Date(expiresAt).getTime() - agora;
  if (falta <= 0) return "venceu";
  const min = Math.ceil(falta / 60000);
  if (min < 60) return `vence em ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `vence em ${h} h`;
  return `vence em ${Math.round(h / 24)} dias`;
}

function valeAinda(c: Convite) {
  const venceu = !!c.expires_at && new Date(c.expires_at).getTime() <= Date.now();
  const esgotou = c.max_uses !== null && c.uses >= c.max_uses;
  return !venceu && !esgotou;
}

const seletor =
  "border-input bg-surface/60 focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none";

export function ConvitesComPrazo({ serverId, aberto }: { serverId: string; aberto: boolean }) {
  const qc = useQueryClient();
  const [validade, setValidade] = useState(5); // 7 dias
  const [usos, setUsos] = useState(0); // sem limite
  const [criando, setCriando] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["convites", serverId],
    enabled: aberto,
    queryFn: async (): Promise<Convite[]> => {
      const { data, error } = await supabase
        .from("server_invites")
        .select("code, created_at, expires_at, max_uses, uses")
        .eq("server_id", serverId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const convites = query.data ?? [];

  const copiar = async (code: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/convite/${code}`);
      setCopiado(code);
      window.setTimeout(() => setCopiado((c) => (c === code ? null : c)), 1800);
      toast.success("Link copiado. Cola no grupo!");
    } catch {
      toast.error("Não consegui copiar. Selecione e copie na mão.");
    }
  };

  const criar = async () => {
    setCriando(true);
    const minutos = VALIDADES[validade]!.minutos;
    const max = USOS[usos]!.max;
    const { data, error } = await supabase.rpc("criar_convite", {
      _server_id: serverId,
      ...(minutos !== null ? { _validade_min: minutos } : {}),
      ...(max !== null ? { _max_usos: max } : {}),
    });
    setCriando(false);
    if (error || !data) {
      toast.error("Não consegui criar o convite.");
      return;
    }
    await qc.invalidateQueries({ queryKey: ["convites", serverId] });
    void copiar(data);
  };

  const revogar = async (code: string) => {
    const { error } = await supabase.from("server_invites").delete().eq("code", code);
    if (error) {
      toast.error("Não consegui revogar o convite.");
      return;
    }
    await qc.invalidateQueries({ queryKey: ["convites", serverId] });
  };

  return (
    <div className="border-border space-y-3 border-t pt-4">
      <div>
        <p className="text-sm font-medium">Convites com prazo</p>
        <p className="text-muted-foreground text-xs">
          Para quando você não quer que o link rode solto: vence sozinho ou depois de tantos usos.
        </p>
      </div>

      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="convite-validade" className="text-xs">
            Vale por
          </Label>
          <select
            id="convite-validade"
            value={validade}
            onChange={(e) => setValidade(Number(e.target.value))}
            className={seletor}
          >
            {VALIDADES.map((v, i) => (
              <option key={v.rotulo} value={i}>
                {v.rotulo}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="convite-usos" className="text-xs">
            Usos
          </Label>
          <select
            id="convite-usos"
            value={usos}
            onChange={(e) => setUsos(Number(e.target.value))}
            className={seletor}
          >
            {USOS.map((u, i) => (
              <option key={u.rotulo} value={i}>
                {u.rotulo}
              </option>
            ))}
          </select>
        </div>
        <Button size="sm" className="h-9" onClick={() => void criar()} disabled={criando}>
          <Plus className="size-4" /> {criando ? "Gerando..." : "Gerar"}
        </Button>
      </div>

      {convites.length > 0 && (
        <ul className="space-y-1">
          {convites.map((c) => {
            const vale = valeAinda(c);
            return (
              <li
                key={c.code}
                className={cn(
                  "border-border bg-surface-2/60 flex items-center gap-2 rounded-lg border px-2.5 py-1.5",
                  !vale && "opacity-50",
                )}
              >
                <span className="font-mono text-sm">{c.code}</span>
                <span className="text-muted-foreground min-w-0 flex-1 truncate text-[11px]">
                  {c.uses}
                  {c.max_uses !== null ? `/${c.max_uses}` : ""} {c.uses === 1 ? "uso" : "usos"} ·{" "}
                  {vale
                    ? prazo(c.expires_at)
                    : c.max_uses !== null && c.uses >= c.max_uses
                      ? "esgotou"
                      : "venceu"}
                </span>
                {vale && (
                  <button
                    title="Copiar link"
                    onClick={() => void copiar(c.code)}
                    className="text-muted-foreground hover:text-foreground rounded p-1"
                  >
                    {copiado === c.code ? (
                      <Check className="text-primary size-4" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </button>
                )}
                <button
                  title={vale ? "Revogar convite" : "Tirar da lista"}
                  onClick={() => void revogar(c.code)}
                  className="text-muted-foreground hover:text-destructive rounded p-1"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
