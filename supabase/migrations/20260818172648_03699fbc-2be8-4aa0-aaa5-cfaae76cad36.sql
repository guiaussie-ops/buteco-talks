REVOKE ALL ON FUNCTION public.is_server_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_server_owner(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.channel_server_id(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_adult(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.shares_server_with(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.is_server_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_server_owner(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.channel_server_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_adult(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shares_server_with(uuid, uuid) TO authenticated;