-- Presença de voz sem fantasma.
--
-- Até aqui a linha em voice_participants só sumia no cleanup do React. Aba
-- fechada no X, internet caindo ou PC desligando deixavam a pessoa "sentada"
-- na mesa para sempre. Agora a presença tem prazo de validade: quem está de
-- verdade na mesa renova a cada 20s, e quem parou de renovar há mais de 150s
-- é removido.
--
-- O prazo é folgado de propósito. Com a aba minimizada — o caso de uso normal
-- aqui, gente jogando enquanto conversa — o Chrome pode estrangular os timers
-- da página para uma batida por minuto quando ela fica oculta e em silêncio
-- por 5 minutos. 150s aguenta duas batidas estranguladas seguidas sem expulsar
-- ninguém que ainda está na call.

ALTER TABLE public.voice_participants
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS voice_participants_last_seen_idx
  ON public.voice_participants (last_seen_at);

-- Varre as presenças vencidas.
--
-- SECURITY DEFINER porque a policy "leave voice" só deixa cada um apagar a
-- própria linha, e varrer fantasma é justamente apagar a dos outros. É seguro
-- por construção: não recebe parâmetro nenhum e a única coisa que consegue
-- apagar são linhas que já passaram do prazo.
CREATE OR REPLACE FUNCTION public.voice_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removidas integer;
BEGIN
  DELETE FROM public.voice_participants
   WHERE last_seen_at < now() - interval '150 seconds';
  GET DIAGNOSTICS removidas = ROW_COUNT;
  RETURN removidas;
END;
$$;

-- Batida de quem está na mesa: renova a própria presença e aproveita para
-- varrer os fantasmas de todo mundo.
--
-- É UPSERT, não UPDATE, de propósito: se alguém for expulso por engano (timer
-- estrangulado além da conta), a batida seguinte recoloca a pessoa na mesa
-- sozinha. O erro dura um ciclo em vez de durar até ela reentrar na mão.
--
-- O INSERT nasce com camera_on/screen_sharing em false, então a batida nunca
-- ressuscita vídeo ligado nem contorna a trava de idade — quem quiser voltar a
-- transmitir passa pelo UPDATE normal, que continua sob a policy com is_adult.
CREATE OR REPLACE FUNCTION public.voice_heartbeat(_channel_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _eu uuid := auth.uid();
BEGIN
  IF _eu IS NULL THEN
    RAISE EXCEPTION 'sem sessão';
  END IF;

  -- SECURITY DEFINER passa por cima do RLS, então a checagem de membro que a
  -- policy "join voice" faria tem que ser feita aqui na mão.
  IF NOT public.is_server_member(public.channel_server_id(_channel_id), _eu) THEN
    RAISE EXCEPTION 'não é membro deste buteco';
  END IF;

  -- Uma pessoa ocupa uma mesa por vez, mesmo invariante do cliente.
  DELETE FROM public.voice_participants
   WHERE user_id = _eu AND channel_id <> _channel_id;

  INSERT INTO public.voice_participants (channel_id, user_id, last_seen_at)
  VALUES (_channel_id, _eu, now())
  ON CONFLICT (channel_id, user_id)
  DO UPDATE SET last_seen_at = now();

  PERFORM public.voice_sweep();
END;
$$;

REVOKE ALL ON FUNCTION public.voice_sweep() FROM public;
REVOKE ALL ON FUNCTION public.voice_heartbeat(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.voice_sweep() TO authenticated;
GRANT EXECUTE ON FUNCTION public.voice_heartbeat(uuid) TO authenticated;
