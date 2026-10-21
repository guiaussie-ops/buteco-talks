-- Segunda parte do histórico da gestão (a primeira cria a tabela e a leitura):
-- as RPCs de gestão passam a anotar o que fazem, e gatilhos anotam o que
-- muda direto nas tabelas.

-- ============================================================================
-- AS RPCs DE GESTÃO, AGORA ANOTANDO
-- ============================================================================

CREATE OR REPLACE FUNCTION public.definir_cargo(_server_id uuid, _user_id uuid, _role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _eu int := COALESCE(public.server_role_rank(_server_id, auth.uid()), 0);
  _alvo int := public.server_role_rank(_server_id, _user_id);
  _novo int := CASE _role WHEN 'admin' THEN 2 WHEN 'moderador' THEN 1 WHEN 'member' THEN 0 END;
  _antes text;
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
  SELECT role INTO _antes FROM public.server_members WHERE server_id = _server_id AND user_id = _user_id;
  UPDATE public.server_members SET role = _role WHERE server_id = _server_id AND user_id = _user_id;
  IF _antes IS DISTINCT FROM _role THEN
    PERFORM public.registrar_acao(_server_id, 'mudou_cargo', _user_id,
      jsonb_build_object('de', _antes, 'para', _role));
  END IF;
END;
$$;

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
    PERFORM public.registrar_acao(_server_id, 'baniu', _user_id,
      jsonb_strip_nulls(jsonb_build_object('motivo', NULLIF(btrim(_motivo), ''))));
  ELSE
    PERFORM public.registrar_acao(_server_id, 'expulsou', _user_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.desbanir(_server_id uuid, _user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_server_admin(_server_id, auth.uid()) THEN
    RAISE EXCEPTION 'só o dono e os admins desbanem';
  END IF;
  DELETE FROM public.server_bans WHERE server_id = _server_id AND user_id = _user_id;
  IF FOUND THEN
    PERFORM public.registrar_acao(_server_id, 'desbaniu', _user_id);
  END IF;
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
      PERFORM public.registrar_acao(_server_id, 'criou_convite', NULL,
        jsonb_build_object('final', right(_code, 4), 'validade_min', _validade_min, 'max_usos', _max_usos));
      RETURN _code;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;
  RAISE EXCEPTION 'Não consegui gerar um convite novo, tenta de novo';
END;
$$;

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
      PERFORM public.registrar_acao(_server_id, 'trocou_link', NULL,
        jsonb_build_object('final', right(_new, 4)));
      RETURN _new;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;

  RAISE EXCEPTION 'Não consegui gerar um convite novo, tenta de novo';
END;
$$;

CREATE OR REPLACE FUNCTION public.salvar_quadro(_server_id uuid, _boas_vindas text, _regras text, _aviso text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_server_admin(_server_id, auth.uid()) THEN
    RAISE EXCEPTION 'só o dono e os admins escrevem no quadro';
  END IF;
  INSERT INTO public.quadro_do_buteco (server_id, boas_vindas, regras, aviso, atualizado_por, atualizado_em)
  VALUES (
    _server_id,
    btrim(coalesce(_boas_vindas, '')),
    btrim(coalesce(_regras, '')),
    btrim(coalesce(_aviso, '')),
    auth.uid(),
    now()
  )
  ON CONFLICT (server_id) DO UPDATE SET
    boas_vindas = EXCLUDED.boas_vindas,
    regras = EXCLUDED.regras,
    aviso = EXCLUDED.aviso,
    atualizado_por = EXCLUDED.atualizado_por,
    atualizado_em = EXCLUDED.atualizado_em;
  PERFORM public.registrar_acao(_server_id, 'editou_quadro');
END;
$$;

-- Igual à versão da entrada guiada, mais a anotação de quem entrou e por
-- qual convite (o final do código; "link fixo" quando foi pelo link do buteco).
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
    PERFORM public.registrar_acao(_server_id, 'entrou', auth.uid(),
      CASE WHEN _convite.code IS NULL THEN jsonb_build_object('link_fixo', true)
           ELSE jsonb_build_object('final', right(_convite.code, 4)) END);
  END IF;

  RETURN jsonb_build_object(
    'status', CASE WHEN _rows > 0 THEN 'joined' ELSE 'already_member' END,
    'server_id', _server_id
  );
END;
$$;

-- ============================================================================
-- O QUE MUDA DIRETO NAS TABELAS (sem RPC): gatilhos
-- ============================================================================

-- Revogar convite é um DELETE direto (policy "quem convida revoga convites").
CREATE OR REPLACE FUNCTION public.anotar_convite_revogado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.registrar_acao(OLD.server_id, 'revogou_convite', NULL,
    jsonb_build_object('final', right(OLD.code, 4)));
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.anotar_convite_revogado() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS anotar_convite_revogado ON public.server_invites;
CREATE TRIGGER anotar_convite_revogado AFTER DELETE ON public.server_invites
  FOR EACH ROW EXECUTE FUNCTION public.anotar_convite_revogado();

-- Nome e placa do buteco mudam por UPDATE direto (ServerSettingsDialog).
CREATE OR REPLACE FUNCTION public.anotar_buteco_editado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name OR NEW.icon_emoji IS DISTINCT FROM OLD.icon_emoji THEN
    PERFORM public.registrar_acao(NEW.id, 'editou_buteco', NULL, jsonb_build_object(
      'nome_antes', OLD.name, 'nome', NEW.name, 'emoji_antes', OLD.icon_emoji, 'emoji', NEW.icon_emoji));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.anotar_buteco_editado() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS anotar_buteco_editado ON public.servers;
CREATE TRIGGER anotar_buteco_editado AFTER UPDATE OF name, icon_emoji ON public.servers
  FOR EACH ROW EXECUTE FUNCTION public.anotar_buteco_editado();

-- Mesas: criar, renomear e apagar. Arrumar a ordem não entra: um arrastar
-- mexe em várias mesas e só faria barulho no histórico.
CREATE OR REPLACE FUNCTION public.anotar_mesa()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.registrar_acao(NEW.server_id, 'criou_mesa', NULL,
      jsonb_build_object('nome', NEW.name, 'tipo', NEW.kind));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.registrar_acao(OLD.server_id, 'apagou_mesa', NULL,
      jsonb_build_object('nome', OLD.name, 'tipo', OLD.kind));
    RETURN OLD;
  ELSIF NEW.name IS DISTINCT FROM OLD.name THEN
    PERFORM public.registrar_acao(NEW.server_id, 'renomeou_mesa', NULL,
      jsonb_build_object('de', OLD.name, 'para', NEW.name, 'tipo', NEW.kind));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.anotar_mesa() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS anotar_mesa ON public.channels;
CREATE TRIGGER anotar_mesa AFTER INSERT OR DELETE OR UPDATE OF name ON public.channels
  FOR EACH ROW EXECUTE FUNCTION public.anotar_mesa();
