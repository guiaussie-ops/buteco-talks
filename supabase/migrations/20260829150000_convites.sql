-- Bloco "Convites": link de convite, entrada por código e revogação.

-- Entrar por código. Devolve o estado da tentativa em vez de estourar exceção,
-- para o cliente distinguir "entrou" de "já era membro" e de "código não existe".
-- Aceita o link inteiro colado: fica só com o trecho depois da última barra.
DROP FUNCTION IF EXISTS public.join_server_by_code(text);

CREATE FUNCTION public.join_server_by_code(_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _clean text;
  _server_id uuid;
  _rows int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Você precisa estar autenticado';
  END IF;

  -- regexp_replace tira query string e âncora; o split pega o último segmento.
  _clean := lower(trim(regexp_replace(coalesce(_code, ''), '[?#].*$', '')));
  _clean := trim(both '/' from _clean);
  _clean := split_part(_clean, '/', greatest(array_length(string_to_array(_clean, '/'), 1), 1));

  IF _clean = '' THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  SELECT id INTO _server_id FROM public.servers WHERE invite_code = _clean;
  IF _server_id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.server_members
    WHERE server_id = _server_id AND user_id = auth.uid()
  ) THEN
    RETURN jsonb_build_object('status', 'already_member', 'server_id', _server_id);
  END IF;

  INSERT INTO public.server_members (server_id, user_id)
  VALUES (_server_id, auth.uid())
  ON CONFLICT (server_id, user_id) DO NOTHING;
  GET DIAGNOSTICS _rows = ROW_COUNT;

  RETURN jsonb_build_object(
    'status', CASE WHEN _rows > 0 THEN 'joined' ELSE 'already_member' END,
    'server_id', _server_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.join_server_by_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_server_by_code(text) TO authenticated;

-- Revogar o convite antigo. invite_code não é gravável pela API (o GRANT de
-- UPDATE cobre só name e icon_emoji), então a troca passa por aqui.
CREATE OR REPLACE FUNCTION public.regenerate_invite_code(_server_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new text;
BEGIN
  IF NOT public.is_server_admin(_server_id, auth.uid()) THEN
    RAISE EXCEPTION 'Só o dono e os admins podem trocar o convite';
  END IF;

  -- UNIQUE em invite_code: na colisão (improvável) sorteia de novo.
  FOR _i IN 1..5 LOOP
    _new := encode(gen_random_bytes(5), 'hex');
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

REVOKE ALL ON FUNCTION public.regenerate_invite_code(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regenerate_invite_code(uuid) TO authenticated;
