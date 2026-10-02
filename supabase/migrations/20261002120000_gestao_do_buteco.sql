-- Gestão do buteco: cargos (dono > admin > moderador > membro), expulsar e
-- banir, categorias e ordem das mesas, e convites com prazo e limite de usos.
--
-- Fecha também um buraco antigo: a policy "join server" deixava qualquer
-- pessoa se inserir em server_members de qualquer buteco cujo id conhecesse,
-- com o cargo que quisesse ("owner" incluso). Entrar agora é só por convite
-- (RPC), e o insert direto ficou restrito ao dono no momento de abrir o buteco.

-- ============================================================================
-- CARGOS
-- ============================================================================

-- Peso do cargo: 3 dono, 2 admin, 1 moderador, 0 membro, NULL fora do buteco.
-- Toda decisão de "quem pode mexer em quem" compara pesos: só se mexe em quem
-- pesa menos que você.
CREATE OR REPLACE FUNCTION public.server_role_rank(_server_id uuid, _user_id uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.servers s WHERE s.id = _server_id AND s.owner_id = _user_id) THEN 3
    ELSE (
      SELECT CASE m.role WHEN 'owner' THEN 3 WHEN 'admin' THEN 2 WHEN 'moderador' THEN 1 ELSE 0 END
      FROM public.server_members m
      WHERE m.server_id = _server_id AND m.user_id = _user_id
    )
  END;
$$;
REVOKE ALL ON FUNCTION public.server_role_rank(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.server_role_rank(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_server_moderator(_server_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(public.server_role_rank(_server_id, _user_id), 0) >= 1;
$$;
REVOKE ALL ON FUNCTION public.is_server_moderator(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_server_moderator(uuid, uuid) TO authenticated;

ALTER TABLE public.server_members DROP CONSTRAINT IF EXISTS server_members_role_valido;
ALTER TABLE public.server_members ADD CONSTRAINT server_members_role_valido
  CHECK (role IN ('owner', 'admin', 'moderador', 'member'));

-- server_members só muda por RPC. O insert direto que sobra é o do dono
-- sentando no próprio buteco recém-aberto (o cliente faz isso ao criar).
REVOKE INSERT, UPDATE ON public.server_members FROM authenticated;
GRANT INSERT (server_id, user_id, role) ON public.server_members TO authenticated;

DROP POLICY IF EXISTS "join server" ON public.server_members;
DROP POLICY IF EXISTS "dono senta no proprio buteco" ON public.server_members;
CREATE POLICY "dono senta no proprio buteco" ON public.server_members FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND role = 'owner'
    AND public.is_server_owner(server_id, auth.uid())
  );

-- Sair por conta própria continua livre, menos para o dono: buteco sem dono
-- ficaria sem ninguém que pudesse fechá-lo. Expulsar é pela RPC `expulsar`.
DROP POLICY IF EXISTS "leave or owner removes" ON public.server_members;
DROP POLICY IF EXISTS "cada um sai quando quiser" ON public.server_members;
CREATE POLICY "cada um sai quando quiser" ON public.server_members FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND NOT public.is_server_owner(server_id, auth.uid()));

-- Moderador apaga mensagem dos outros (antes: só dono e admins).
DROP POLICY IF EXISTS "delete own messages" ON public.messages;
CREATE POLICY "delete own messages" ON public.messages FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_server_moderator(public.channel_server_id(channel_id), auth.uid()));

DROP POLICY IF EXISTS "chat imagens apagar" ON storage.objects;
CREATE POLICY "chat imagens apagar" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-images'
    AND (
      (storage.foldername(name))[2] = auth.uid()::text
      OR public.is_server_moderator(public.channel_server_id(public.chat_image_channel(name)), auth.uid())
    )
  );

CREATE OR REPLACE FUNCTION public.definir_cargo(_server_id uuid, _user_id uuid, _role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _eu int := COALESCE(public.server_role_rank(_server_id, auth.uid()), 0);
  _alvo int := public.server_role_rank(_server_id, _user_id);
  _novo int := CASE _role WHEN 'admin' THEN 2 WHEN 'moderador' THEN 1 WHEN 'member' THEN 0 END;
BEGIN
  IF _novo IS NULL THEN
    RAISE EXCEPTION 'cargo inválido: %', _role;
  END IF;
  IF _alvo IS NULL THEN
    RAISE EXCEPTION 'essa pessoa não está no buteco';
  END IF;
  -- Admin promove até moderador; dono promove até admin. Ninguém mexe em
  -- quem pesa igual ou mais, nem em si mesmo.
  IF _eu < 2 OR _alvo >= _eu OR _novo >= _eu THEN
    RAISE EXCEPTION 'sem permissão para mudar esse cargo';
  END IF;
  UPDATE public.server_members SET role = _role WHERE server_id = _server_id AND user_id = _user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.definir_cargo(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.definir_cargo(uuid, uuid, text) TO authenticated;

-- ============================================================================
-- EXPULSAR E BANIR
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.server_bans (
  server_id uuid NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  banned_by uuid,
  reason text CHECK (reason IS NULL OR char_length(reason) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, user_id)
);
GRANT SELECT ON public.server_bans TO authenticated;
GRANT ALL ON public.server_bans TO service_role;
ALTER TABLE public.server_bans ENABLE ROW LEVEL SECURITY;

-- A lista de banidos é assunto de quem pode banir. Escrita só pelas RPCs.
DROP POLICY IF EXISTS "admins veem banidos" ON public.server_bans;
CREATE POLICY "admins veem banidos" ON public.server_bans FOR SELECT TO authenticated
  USING (public.is_server_admin(server_id, auth.uid()));

-- Moderador expulsa membro; banir (expulsar e não deixar voltar) é de admin.
-- Quem sai leva junto a cadeira na mesa de voz e as marcas de leitura.
CREATE OR REPLACE FUNCTION public.expulsar(_server_id uuid, _user_id uuid, _banir boolean DEFAULT false, _motivo text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _eu int := COALESCE(public.server_role_rank(_server_id, auth.uid()), 0);
  _alvo int := public.server_role_rank(_server_id, _user_id);
BEGIN
  IF _user_id = auth.uid() THEN
    RAISE EXCEPTION 'para sair, use sair do buteco';
  END IF;
  IF _eu < (CASE WHEN _banir THEN 2 ELSE 1 END) OR COALESCE(_alvo, -1) >= _eu THEN
    RAISE EXCEPTION 'sem permissão para tirar essa pessoa';
  END IF;

  DELETE FROM public.voice_participants v
  USING public.channels c
  WHERE v.channel_id = c.id AND c.server_id = _server_id AND v.user_id = _user_id;
  DELETE FROM public.channel_reads r
  USING public.channels c
  WHERE r.channel_id = c.id AND c.server_id = _server_id AND r.user_id = _user_id;
  DELETE FROM public.server_members WHERE server_id = _server_id AND user_id = _user_id;

  IF _banir THEN
    INSERT INTO public.server_bans (server_id, user_id, banned_by, reason)
    VALUES (_server_id, _user_id, auth.uid(), NULLIF(btrim(_motivo), ''))
    ON CONFLICT (server_id, user_id) DO UPDATE
      SET banned_by = EXCLUDED.banned_by, reason = EXCLUDED.reason, created_at = now();
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.expulsar(uuid, uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expulsar(uuid, uuid, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.desbanir(_server_id uuid, _user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_server_admin(_server_id, auth.uid()) THEN
    RAISE EXCEPTION 'só o dono e os admins desbanem';
  END IF;
  DELETE FROM public.server_bans WHERE server_id = _server_id AND user_id = _user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.desbanir(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.desbanir(uuid, uuid) TO authenticated;

-- Perfil de quem foi banido: a policy de profiles só mostra quem divide
-- buteco comigo, e o banido não divide mais. A lista de banidos precisa do nome.
CREATE OR REPLACE FUNCTION public.banidos(_server_id uuid)
RETURNS TABLE (user_id uuid, display_name text, username text, avatar_url text, reason text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_server_admin(_server_id, auth.uid()) THEN
    RAISE EXCEPTION 'só o dono e os admins veem os banidos';
  END IF;
  RETURN QUERY
    SELECT b.user_id, p.display_name, p.username, p.avatar_url, b.reason, b.created_at
    FROM public.server_bans b
    LEFT JOIN public.profiles p ON p.id = b.user_id
    WHERE b.server_id = _server_id
    ORDER BY b.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.banidos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.banidos(uuid) TO authenticated;

-- ============================================================================
-- CATEGORIAS E ORDEM DAS MESAS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.channel_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS channel_categories_server_idx ON public.channel_categories (server_id, position);

GRANT SELECT, INSERT, DELETE ON public.channel_categories TO authenticated;
GRANT UPDATE (name, position) ON public.channel_categories TO authenticated;
GRANT ALL ON public.channel_categories TO service_role;
ALTER TABLE public.channel_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "membros veem categorias" ON public.channel_categories;
CREATE POLICY "membros veem categorias" ON public.channel_categories FOR SELECT TO authenticated
  USING (public.is_server_member(server_id, auth.uid()));
DROP POLICY IF EXISTS "admins criam categorias" ON public.channel_categories;
CREATE POLICY "admins criam categorias" ON public.channel_categories FOR INSERT TO authenticated
  WITH CHECK (public.is_server_admin(server_id, auth.uid()));
DROP POLICY IF EXISTS "admins mudam categorias" ON public.channel_categories;
CREATE POLICY "admins mudam categorias" ON public.channel_categories FOR UPDATE TO authenticated
  USING (public.is_server_admin(server_id, auth.uid()))
  WITH CHECK (public.is_server_admin(server_id, auth.uid()));
DROP POLICY IF EXISTS "admins apagam categorias" ON public.channel_categories;
CREATE POLICY "admins apagam categorias" ON public.channel_categories FOR DELETE TO authenticated
  USING (public.is_server_admin(server_id, auth.uid()));

-- Apagar a categoria solta as mesas dela, não as apaga.
ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.channel_categories(id) ON DELETE SET NULL;
GRANT UPDATE (name, position, category_id) ON public.channels TO authenticated;

-- A mesa só pode morar numa categoria do próprio buteco.
CREATE OR REPLACE FUNCTION public.channels_categoria_do_buteco()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.channel_categories k WHERE k.id = NEW.category_id AND k.server_id = NEW.server_id
  ) THEN
    RAISE EXCEPTION 'categoria de outro buteco';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS channels_categoria_do_buteco ON public.channels;
CREATE TRIGGER channels_categoria_do_buteco BEFORE INSERT OR UPDATE OF category_id ON public.channels
  FOR EACH ROW EXECUTE FUNCTION public.channels_categoria_do_buteco();

-- Os butecos que já existem ganham as duas categorias que a barra lateral já
-- mostrava ("Mesas de texto" e "Mesas de voz"), na ordem alfabética de hoje:
-- ninguém abre o app e estranha.
DO $$
DECLARE
  s record;
  _texto uuid;
  _voz uuid;
BEGIN
  FOR s IN
    SELECT sv.id FROM public.servers sv
    WHERE NOT EXISTS (SELECT 1 FROM public.channel_categories k WHERE k.server_id = sv.id)
  LOOP
    INSERT INTO public.channel_categories (server_id, name, position)
      VALUES (s.id, 'Mesas de texto', 0) RETURNING id INTO _texto;
    INSERT INTO public.channel_categories (server_id, name, position)
      VALUES (s.id, 'Mesas de voz', 1) RETURNING id INTO _voz;
    UPDATE public.channels c
      SET category_id = CASE WHEN c.kind = 'voice' THEN _voz ELSE _texto END,
          position = o.n
      FROM (
        SELECT id, (row_number() OVER (ORDER BY kind, name))::int - 1 AS n
        FROM public.channels WHERE server_id = s.id
      ) o
      WHERE c.id = o.id;
  END LOOP;
END $$;

-- Grava a arrumação inteira de uma vez: a ordem das categorias e, para cada
-- mesa, a categoria e a posição. Assim um arrastar não vira dez updates
-- soltos que outra pessoa poderia ver pela metade.
CREATE OR REPLACE FUNCTION public.organizar_mesas(_server_id uuid, _categorias uuid[], _mesas jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_server_admin(_server_id, auth.uid()) THEN
    RAISE EXCEPTION 'só o dono e os admins arrumam as mesas';
  END IF;

  UPDATE public.channel_categories k
    SET position = o.n
    FROM (SELECT id, (ord - 1)::int AS n FROM unnest(_categorias) WITH ORDINALITY AS t(id, ord)) o
    WHERE k.id = o.id AND k.server_id = _server_id;

  -- O trigger confere que a categoria é deste buteco.
  UPDATE public.channels c
    SET position = o.n, category_id = o.category_id
    FROM (
      SELECT (e ->> 'id')::uuid AS id, NULLIF(e ->> 'category_id', '')::uuid AS category_id, (ord - 1)::int AS n
      FROM jsonb_array_elements(_mesas) WITH ORDINALITY AS t(e, ord)
    ) o
    WHERE c.id = o.id AND c.server_id = _server_id;
END;
$$;
REVOKE ALL ON FUNCTION public.organizar_mesas(uuid, uuid[], jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organizar_mesas(uuid, uuid[], jsonb) TO authenticated;

-- ============================================================================
-- CONVITES COM PRAZO E LIMITE
-- ============================================================================

-- O link fixo (servers.invite_code) continua existindo como estava. Estes são
-- os convites extras, cada um com validade e número de usos próprios.
CREATE TABLE IF NOT EXISTS public.server_invites (
  code text PRIMARY KEY,
  server_id uuid NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  max_uses int CHECK (max_uses IS NULL OR max_uses > 0),
  uses int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS server_invites_server_idx ON public.server_invites (server_id);

GRANT SELECT, DELETE ON public.server_invites TO authenticated;
GRANT ALL ON public.server_invites TO service_role;
ALTER TABLE public.server_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins veem convites" ON public.server_invites;
CREATE POLICY "admins veem convites" ON public.server_invites FOR SELECT TO authenticated
  USING (public.is_server_admin(server_id, auth.uid()));
DROP POLICY IF EXISTS "admins revogam convites" ON public.server_invites;
CREATE POLICY "admins revogam convites" ON public.server_invites FOR DELETE TO authenticated
  USING (public.is_server_admin(server_id, auth.uid()));

-- Criar é por RPC porque o código é sorteado no banco, com o mesmo formato
-- do link fixo (10 hex), e precisa não colidir com nenhum dos dois.
CREATE OR REPLACE FUNCTION public.criar_convite(_server_id uuid, _validade_min int DEFAULT NULL, _max_usos int DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _code text;
BEGIN
  IF NOT public.is_server_admin(_server_id, auth.uid()) THEN
    RAISE EXCEPTION 'só o dono e os admins criam convites';
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
REVOKE ALL ON FUNCTION public.criar_convite(uuid, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_convite(uuid, int, int) TO authenticated;

-- Entrar por código, agora olhando também os convites extras e os banidos.
-- Status: joined | already_member | not_found | expired | banned.
CREATE OR REPLACE FUNCTION public.join_server_by_code(_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _clean text;
  _server_id uuid;
  _convite public.server_invites%ROWTYPE;
  _rows int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Você precisa estar autenticado';
  END IF;

  _clean := lower(trim(regexp_replace(coalesce(_code, ''), '[?#].*$', '')));
  _clean := trim(both '/' from _clean);
  _clean := split_part(_clean, '/', greatest(array_length(string_to_array(_clean, '/'), 1), 1));

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

  IF _convite.code IS NOT NULL AND (
    (_convite.expires_at IS NOT NULL AND _convite.expires_at <= now())
    OR (_convite.max_uses IS NOT NULL AND _convite.uses >= _convite.max_uses)
  ) THEN
    RETURN jsonb_build_object('status', 'expired');
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

-- ============================================================================
-- REALTIME
-- ============================================================================

-- Mesas, categorias e membros passam a avisar os clientes: quem foi expulso
-- sai da tela na hora, e a arrumação de um admin aparece para todo mundo.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['channels', 'channel_categories', 'server_members'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
