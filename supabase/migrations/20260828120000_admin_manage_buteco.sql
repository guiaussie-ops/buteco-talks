-- Cargos de gestão do buteco: dono e admins podem editar o buteco e as mesas.
-- Apagar o buteco inteiro continua exclusivo do dono.

CREATE OR REPLACE FUNCTION public.is_server_admin(_server_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.servers s
    WHERE s.id = _server_id AND s.owner_id = _user_id
  ) OR EXISTS (
    SELECT 1 FROM public.server_members m
    WHERE m.server_id = _server_id
      AND m.user_id = _user_id
      AND m.role IN ('owner', 'admin')
  );
$$;

REVOKE ALL ON FUNCTION public.is_server_admin(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_server_admin(uuid, uuid) TO authenticated;

-- SERVERS: renomear / trocar emoji. Só estas duas colunas ficam graváveis,
-- então owner_id e invite_code não podem ser alterados pela API.
REVOKE UPDATE ON public.servers FROM authenticated;
GRANT UPDATE (name, icon_emoji) ON public.servers TO authenticated;

DROP POLICY IF EXISTS "owner update server" ON public.servers;
CREATE POLICY "admins update server" ON public.servers FOR UPDATE TO authenticated
  USING (public.is_server_admin(id, auth.uid()))
  WITH CHECK (public.is_server_admin(id, auth.uid()));

-- CHANNELS: criar / renomear / apagar mesas.
REVOKE UPDATE ON public.channels FROM authenticated;
GRANT UPDATE (name, position) ON public.channels TO authenticated;

DROP POLICY IF EXISTS "owner creates channels" ON public.channels;
CREATE POLICY "admins create channels" ON public.channels FOR INSERT TO authenticated
  WITH CHECK (public.is_server_admin(server_id, auth.uid()));

DROP POLICY IF EXISTS "owner updates channels" ON public.channels;
CREATE POLICY "admins update channels" ON public.channels FOR UPDATE TO authenticated
  USING (public.is_server_admin(server_id, auth.uid()))
  WITH CHECK (public.is_server_admin(server_id, auth.uid()));

DROP POLICY IF EXISTS "owner deletes channels" ON public.channels;
CREATE POLICY "admins delete channels" ON public.channels FOR DELETE TO authenticated
  USING (public.is_server_admin(server_id, auth.uid()));

-- Apagar o buteco inteiro segue restrito ao dono ("owner delete server", da migration base).
-- messages e voice_participants somem por ON DELETE CASCADE em channels;
-- channels e server_members somem por ON DELETE CASCADE em servers.
