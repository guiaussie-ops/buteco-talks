/**
 * Presença de voz: as duas camadas que impedem a tampinha fantasma.
 *
 * 1. Fechamento normal da aba — `saidaComKeepalive` abaixo, que entrega o
 *    DELETE mesmo com a página sendo destruída.
 * 2. Heartbeat + expiração no banco (`voice_heartbeat` / `voice_sweep`), que
 *    cobre o que a camada 1 não pega: internet caindo, travamento, PC
 *    desligando na tomada.
 */

/** De quanto em quanto tempo quem está na mesa renova a presença. */
export const HEARTBEAT_MS = 20_000;

/**
 * De quanto em quanto tempo quem só *olha* a lista varre os vencidos. Sem isso,
 * com ninguém em mesa nenhuma, o fantasma ficaria na tela do espectador até
 * alguém entrar numa mesa e bater o primeiro heartbeat.
 */
export const SWEEP_MS = 30_000;

/**
 * Remove a presença numa aba que está fechando.
 *
 * O DELETE normal do supabase-js morre junto com a página: o navegador cancela
 * as requisições em voo no unload. Com `keepalive` ele se compromete a entregar
 * mesmo depois de a aba sumir. `sendBeacon` seria o caminho óbvio, mas não
 * aceita header de autorização, e o PostgREST precisa do Bearer para saber quem
 * está saindo.
 *
 * É o melhor esforço, não uma garantia — se falhar, a expiração de 150s no
 * banco resolve. Por isso ninguém espera nem trata o resultado.
 */
export function saidaComKeepalive(channelId: string, userId: string, accessToken: string) {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !accessToken) return;

  const alvo =
    `${url}/rest/v1/voice_participants` +
    `?channel_id=eq.${encodeURIComponent(channelId)}&user_id=eq.${encodeURIComponent(userId)}`;

  try {
    void fetch(alvo, {
      method: "DELETE",
      keepalive: true,
      headers: {
        apikey: key,
        Authorization: `Bearer ${accessToken}`,
      },
    }).catch(() => undefined);
  } catch {
    // Navegador sem keepalive, cota de keepalive estourada: cai na camada 2.
  }
}
