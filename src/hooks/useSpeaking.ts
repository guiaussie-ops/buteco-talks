import { useEffect, useState } from "react";

type Entry = { id: string; stream: MediaStream | null };

/**
 * Detecta quem está falando analisando o volume de cada faixa de áudio.
 * Roda só no navegador (Web Audio API).
 */
export function useSpeaking(entries: Entry[]) {
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({});
  const key = entries.map((e) => `${e.id}:${e.stream?.id ?? "none"}`).join("|");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const withAudio = entries.filter((e) => e.stream && e.stream.getAudioTracks().length > 0);
    if (withAudio.length === 0) {
      setSpeaking({});
      return;
    }

    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    const nodes = withAudio.map((e) => {
      const source = ctx.createMediaStreamSource(e.stream!);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      return { id: e.id, analyser, data: new Uint8Array(analyser.frequencyBinCount) };
    });

    let frame = 0;
    let last = 0;
    const tick = (t: number) => {
      frame = requestAnimationFrame(tick);
      if (t - last < 120) return;
      last = t;
      const next: Record<string, boolean> = {};
      for (const n of nodes) {
        n.analyser.getByteTimeDomainData(n.data);
        let sum = 0;
        for (let i = 0; i < n.data.length; i++) {
          const v = (n.data[i]! - 128) / 128;
          sum += v * v;
        }
        next[n.id] = Math.sqrt(sum / n.data.length) > 0.045;
      }
      setSpeaking((prev) => {
        const changed = nodes.some((n) => prev[n.id] !== next[n.id]);
        return changed ? next : prev;
      });
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      void ctx.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return speaking;
}
