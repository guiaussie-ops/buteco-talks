import { useEffect, useState } from "react";
import Cropper from "react-easy-crop";
import { Loader2, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import { recortarFoto, type Area } from "@/lib/recorte";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

const ZOOM_MIN = 1;
const ZOOM_MAX = 3;

/**
 * O editor da foto do perfil: a imagem escolhida sob uma máscara redonda, do
 * tamanho da tampinha. Arrasta para posicionar, zoom no slider (ou na roda do
 * mouse, ou na pinça), gira de 90 em 90. Só ao aplicar a foto é recortada de
 * verdade — quem decide o que fazer com ela é quem abriu.
 */
export function RecorteDeFoto({
  arquivo,
  onCancelar,
  onAplicar,
}: {
  /** O arquivo escolhido; null fecha o editor. */
  arquivo: File | null;
  onCancelar: () => void;
  /** Recebe a foto já recortada. Devolve se deu certo: o editor só fecha aí. */
  onAplicar: (foto: Blob) => Promise<boolean>;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [posicao, setPosicao] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(ZOOM_MIN);
  const [graus, setGraus] = useState(0);
  const [area, setArea] = useState<Area | null>(null);
  const [aplicando, setAplicando] = useState(false);

  const redefinir = () => {
    setPosicao({ x: 0, y: 0 });
    setZoom(ZOOM_MIN);
    setGraus(0);
  };

  useEffect(() => {
    if (!arquivo) return;
    const url = URL.createObjectURL(arquivo);
    setSrc(url);
    redefinir();
    setArea(null);
    return () => {
      URL.revokeObjectURL(url);
      setSrc(null);
    };
  }, [arquivo]);

  const aplicar = async () => {
    if (!src || !area) return;
    setAplicando(true);
    try {
      const foto = await recortarFoto(src, area, graus);
      if (await onAplicar(foto)) onCancelar();
    } catch {
      toast.error("Não consegui recortar essa imagem. Tenta outra.");
    } finally {
      setAplicando(false);
    }
  };

  return (
    <Dialog open={!!arquivo} onOpenChange={(o) => !o && !aplicando && onCancelar()}>
      <DialogContent className="bg-background border-border gap-0 overflow-hidden p-0 sm:max-w-md">
        <div className="px-5 pt-5 pb-3">
          <DialogTitle className="font-display text-2xl tracking-wide uppercase">
            Ajeitar a foto
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-xs">
            Arrasta pra posicionar. O que fica dentro do círculo vira a sua tampinha.
          </DialogDescription>
        </div>

        <div className="relative aspect-square w-full bg-black">
          {src && (
            <Cropper
              image={src}
              crop={posicao}
              zoom={zoom}
              rotation={graus}
              minZoom={ZOOM_MIN}
              maxZoom={ZOOM_MAX}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setPosicao}
              onZoomChange={setZoom}
              onRotationChange={setGraus}
              onCropComplete={(_, pixels) => setArea(pixels)}
              style={{
                // Fora do círculo, escurecido; a borda do círculo no creme do papel.
                cropAreaStyle: {
                  border: "3px dotted var(--papel)",
                  boxShadow: "0 0 0 9999em rgb(10 6 3 / 0.72)",
                },
              }}
            />
          )}
        </div>

        <div className="bg-papel text-papel-tinta flex flex-col gap-4 px-5 py-4">
          <div className="flex items-center gap-3">
            <ZoomOut className="size-4 shrink-0 opacity-70" aria-hidden="true" />
            <Slider
              value={[zoom]}
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              step={0.01}
              onValueChange={([z]) => z !== undefined && setZoom(z)}
              aria-label="Zoom"
              className="flex-1"
            />
            <ZoomIn className="size-4 shrink-0 opacity-70" aria-hidden="true" />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setGraus((g) => (g + 90) % 360)}
              className="border-papel-linha text-papel-tinta ml-1 bg-transparent"
              aria-label="Girar 90 graus"
              title="Girar 90°"
            >
              <RotateCw className="size-4" />
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={redefinir}
              disabled={aplicando}
              className="text-papel-tinta hover:bg-papel-linha/40 hover:text-papel-tinta"
            >
              Redefinir
            </Button>
            <div className="ml-auto flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onCancelar}
                disabled={aplicando}
                className="border-papel-linha text-papel-tinta bg-transparent"
              >
                Cancelar
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void aplicar()}
                disabled={!area || aplicando}
                className="bg-neon text-neon-foreground hover:bg-neon/90 font-semibold shadow-[var(--glow-neon)]"
              >
                {aplicando && <Loader2 className="size-4 animate-spin" />}
                Aplicar
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
