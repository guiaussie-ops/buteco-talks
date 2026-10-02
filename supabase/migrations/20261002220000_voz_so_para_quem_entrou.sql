-- As duas funções da presença de voz eram executáveis por quem não entrou na
-- conta (o advisor do Supabase apontava as duas). O app só as chama logado:
-- o heartbeat a cada 20 s de quem está na mesa, e a varredura antes de ler
-- quem está sentado. Visitante anônimo não tem o que fazer com nenhuma.
REVOKE EXECUTE ON FUNCTION public.voice_heartbeat(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.voice_sweep() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.voice_heartbeat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.voice_sweep() TO authenticated;
