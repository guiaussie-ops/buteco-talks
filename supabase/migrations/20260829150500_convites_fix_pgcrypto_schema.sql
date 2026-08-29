-- Conserta regenerate_invite_code: com search_path fixo em public, a função não
-- enxergava gen_random_bytes, que o pgcrypto instala no schema extensions.
-- (O DEFAULT de servers.invite_code não sofre disso: o schema foi resolvido no
-- CREATE TABLE e ficou gravado já qualificado.)

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

REVOKE ALL ON FUNCTION public.regenerate_invite_code(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regenerate_invite_code(uuid) TO authenticated;
