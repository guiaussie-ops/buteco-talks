-- Enquanto o app é teste, convidar gente é privilégio de quem cuida do app,
-- em qualquer buteco. Nem dono de buteco nem admin chamam ninguém para dentro.
--
-- Esconder o botão não bastava: servers.invite_code era legível por qualquer
-- membro, e repassar esse código já é convidar. Agora a coluna sai do SELECT
-- da API e quem pode convidar pega o código pela RPC meu_convite.

-- Quem pode convidar. Ninguém lê nem escreve pela API: muda-se por migração.
CREATE TABLE IF NOT EXISTS public.quem_convida (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
);
REVOKE ALL ON public.quem_convida FROM anon, authenticated;
ALTER TABLE public.quem_convida ENABLE ROW LEVEL SECURITY;

INSERT INTO public.quem_convida (user_id)
SELECT id FROM auth.users WHERE email = 'buteco.multiplay@gmail.com'
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.pode_convidar(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.quem_convida WHERE user_id = _user_id);
$$;
REVOKE ALL ON FUNCTION public.pode_convidar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pode_convidar(uuid) TO authenticated;

-- Lembrando: GRANT por coluna não restringe nada se a tabela inteira continua
-- concedida. Primeiro o REVOKE da tabela, depois as colunas que podem.
REVOKE SELECT ON public.servers FROM anon, authenticated;
GRANT SELECT (id, name, icon_emoji, owner_id, created_at) ON public.servers TO authenticated;

-- E escrever o próprio código na criação também não tem por quê: ele nasce do DEFAULT.
REVOKE INSERT, UPDATE ON public.servers FROM anon;
REVOKE INSERT ON public.servers FROM authenticated;
GRANT INSERT (id, name, icon_emoji, owner_id) ON public.servers TO authenticated;

CREATE OR REPLACE FUNCTION public.meu_convite(_server_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT invite_code FROM public.servers WHERE id = _server_id AND public.pode_convidar(auth.uid());
$$;
REVOKE ALL ON FUNCTION public.meu_convite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meu_convite(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.regenerate_invite_code(_server_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new text;
BEGIN
  IF NOT public.pode_convidar(auth.uid()) THEN
    RAISE EXCEPTION 'Só quem cuida do app pode trocar o convite';
  END IF;

  FOR _i IN 1..5 LOOP
    _new := encode(extensions.gen_random_bytes(5), 'hex');
    BEGIN
      UPDATE public.servers SET invite_code = _new WHERE id = _server_id;
      RETURN _new;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;

  RAISE EXCEPTION 'Não consegui gerar um convite novo, tenta de novo';
END;
$$;

CREATE OR REPLACE FUNCTION public.criar_convite(_server_id uuid, _validade_min int DEFAULT NULL, _max_usos int DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _code text;
BEGIN
  IF NOT public.pode_convidar(auth.uid()) THEN
    RAISE EXCEPTION 'só quem cuida do app cria convites';
  END IF;
  IF _validade_min IS NOT NULL AND _validade_min <= 0 THEN
    RAISE EXCEPTION 'validade inválida';
  END IF;

  FOR _i IN 1..5 LOOP
    _code := encode(extensions.gen_random_bytes(5), 'hex');
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.servers WHERE invite_code = _code);
    BEGIN
      INSERT INTO public.server_invites (code, server_id, created_by, expires_at, max_uses)
      VALUES (
        _code, _server_id, auth.uid(),
        CASE WHEN _validade_min IS NULL THEN NULL ELSE now() + make_interval(mins => _validade_min) END,
        _max_usos
      );
      RETURN _code;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;
  RAISE EXCEPTION 'Não consegui gerar um convite novo, tenta de novo';
END;
$$;

-- Convite com prazo dado por outra pessoa para de valer.
DELETE FROM public.server_invites
WHERE NOT public.pode_convidar(created_by);

DROP POLICY IF EXISTS "admins veem convites" ON public.server_invites;
DROP POLICY IF EXISTS "admins revogam convites" ON public.server_invites;
CREATE POLICY "quem convida ve convites" ON public.server_invites FOR SELECT TO authenticated
  USING (public.pode_convidar((select auth.uid())));
CREATE POLICY "quem convida revoga convites" ON public.server_invites FOR DELETE TO authenticated
  USING (public.pode_convidar((select auth.uid())));
