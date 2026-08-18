CREATE OR REPLACE FUNCTION public.join_server_by_code(_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _server_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Você precisa estar autenticado';
  END IF;

  SELECT id INTO _server_id FROM public.servers WHERE invite_code = lower(trim(_code));
  IF _server_id IS NULL THEN
    RAISE EXCEPTION 'Convite inválido';
  END IF;

  INSERT INTO public.server_members (server_id, user_id)
  VALUES (_server_id, auth.uid())
  ON CONFLICT (server_id, user_id) DO NOTHING;

  RETURN _server_id;
END;
$$;

REVOKE ALL ON FUNCTION public.join_server_by_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_server_by_code(text) TO authenticated;