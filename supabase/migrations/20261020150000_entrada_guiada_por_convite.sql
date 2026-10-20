-- Entrada guiada por convite: antes de puxar a cadeira, quem chega pelo link
-- vê o buteco (nome, quadro, regras e mesas). E o convite que não abre a
-- porta diz por quê: venceu o prazo, esgotou os usos ou não existe.
--
-- Quem pode convidar não muda: ver_convite só lê um convite que já existe.

-- O mesmo jeito de limpar o código que o join_server_by_code já usava: aceita
-- o link inteiro colado, com barra, ?query ou #hash.
CREATE OR REPLACE FUNCTION public.codigo_do_convite(_code text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  WITH limpo AS (
    SELECT trim(both '/' from lower(trim(regexp_replace(coalesce(_code, ''), '[?#].*$', '')))) AS c
  )
  SELECT split_part(c, '/', greatest(array_length(string_to_array(c, '/'), 1), 1)) FROM limpo;
$$;
REVOKE ALL ON FUNCTION public.codigo_do_convite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.codigo_do_convite(text) TO anon, authenticated;

-- A vitrine do convite. Funciona sem conta: o link chega para quem ainda nem
-- se cadastrou, e é justamente essa pessoa que precisa saber onde está entrando.
-- Quem tem o código já foi chamado, então ver o buteco não abre nada a mais.
--
-- Status: valido | vencido | esgotado | invalido | banido | ja_e_membro.
-- O buteco completo (quadro e mesas) só vai junto quando a porta abre.
CREATE OR REPLACE FUNCTION public.ver_convite(_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _clean text := public.codigo_do_convite(_code);
  _server public.servers%ROWTYPE;
  _convite public.server_invites%ROWTYPE;
  _status text;
BEGIN
  IF _clean = '' THEN
    RETURN jsonb_build_object('status', 'invalido');
  END IF;

  SELECT * INTO _server FROM public.servers WHERE invite_code = _clean;
  IF NOT FOUND THEN
    SELECT * INTO _convite FROM public.server_invites WHERE code = _clean;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('status', 'invalido');
    END IF;
    SELECT * INTO _server FROM public.servers WHERE id = _convite.server_id;
  END IF;

  _status := CASE
    WHEN auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.server_members WHERE server_id = _server.id AND user_id = auth.uid()
    ) THEN 'ja_e_membro'
    WHEN auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.server_bans WHERE server_id = _server.id AND user_id = auth.uid()
    ) THEN 'banido'
    WHEN _convite.expires_at IS NOT NULL AND _convite.expires_at <= now() THEN 'vencido'
    WHEN _convite.max_uses IS NOT NULL AND _convite.uses >= _convite.max_uses THEN 'esgotado'
    ELSE 'valido'
  END;

  IF _status NOT IN ('valido', 'ja_e_membro') THEN
    RETURN jsonb_build_object(
      'status', _status,
      'buteco', jsonb_build_object('nome', _server.name, 'emoji', _server.icon_emoji)
    );
  END IF;

  RETURN jsonb_build_object(
    'status', _status,
    'server_id', _server.id,
    'buteco', jsonb_build_object('nome', _server.name, 'emoji', _server.icon_emoji),
    'membros', (SELECT count(*) FROM public.server_members WHERE server_id = _server.id),
    'vence_em', _convite.expires_at,
    'usos_restantes', CASE WHEN _convite.max_uses IS NULL THEN NULL ELSE _convite.max_uses - _convite.uses END,
    'quadro', (
      SELECT jsonb_build_object('boas_vindas', q.boas_vindas, 'regras', q.regras, 'aviso', q.aviso)
      FROM public.quadro_do_buteco q WHERE q.server_id = _server.id
    ),
    'mesas', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object('nome', c.name, 'tipo', c.kind, 'categoria', k.name)
        ORDER BY k.position NULLS FIRST, c.position, c.created_at
      )
      FROM public.channels c
      LEFT JOIN public.channel_categories k ON k.id = c.category_id
      WHERE c.server_id = _server.id
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.ver_convite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ver_convite(text) TO anon, authenticated;

-- Entrar por código. Igual ao de antes, mas separa "expired" (o prazo
-- passou) de "exhausted" (acabaram os usos), para a tela dizer qual foi.
-- Status: joined | already_member | not_found | expired | exhausted | banned.
CREATE OR REPLACE FUNCTION public.join_server_by_code(_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _clean text := public.codigo_do_convite(_code);
  _server_id uuid;
  _convite public.server_invites%ROWTYPE;
  _rows int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Você precisa estar autenticado';
  END IF;

  IF _clean = '' THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  SELECT id INTO _server_id FROM public.servers WHERE invite_code = _clean;

  IF _server_id IS NULL THEN
    -- FOR UPDATE: duas pessoas entrando juntas no último uso não passam as duas.
    SELECT * INTO _convite FROM public.server_invites WHERE code = _clean FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('status', 'not_found');
    END IF;
    _server_id := _convite.server_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.server_members
    WHERE server_id = _server_id AND user_id = auth.uid()
  ) THEN
    RETURN jsonb_build_object('status', 'already_member', 'server_id', _server_id);
  END IF;

  IF EXISTS (SELECT 1 FROM public.server_bans WHERE server_id = _server_id AND user_id = auth.uid()) THEN
    RETURN jsonb_build_object('status', 'banned');
  END IF;

  IF _convite.code IS NOT NULL THEN
    IF _convite.expires_at IS NOT NULL AND _convite.expires_at <= now() THEN
      RETURN jsonb_build_object('status', 'expired');
    END IF;
    IF _convite.max_uses IS NOT NULL AND _convite.uses >= _convite.max_uses THEN
      RETURN jsonb_build_object('status', 'exhausted');
    END IF;
  END IF;

  INSERT INTO public.server_members (server_id, user_id)
  VALUES (_server_id, auth.uid())
  ON CONFLICT (server_id, user_id) DO NOTHING;
  GET DIAGNOSTICS _rows = ROW_COUNT;

  IF _rows > 0 THEN
    IF _convite.code IS NOT NULL THEN
      UPDATE public.server_invites SET uses = uses + 1 WHERE code = _convite.code;
    END IF;
    -- Quem chega começa com tudo lido: o histórico não acende como novidade.
    INSERT INTO public.channel_reads (user_id, channel_id, last_read_at)
    SELECT auth.uid(), c.id, now() FROM public.channels c
    WHERE c.server_id = _server_id AND c.kind = 'text'
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'status', CASE WHEN _rows > 0 THEN 'joined' ELSE 'already_member' END,
    'server_id', _server_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.join_server_by_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_server_by_code(text) TO authenticated;
