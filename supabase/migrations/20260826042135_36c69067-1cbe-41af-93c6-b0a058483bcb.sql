GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.servers TO authenticated;
GRANT ALL ON public.servers TO service_role;

GRANT SELECT, INSERT, DELETE ON public.server_members TO authenticated;
GRANT ALL ON public.server_members TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.channels TO authenticated;
GRANT ALL ON public.channels TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_participants TO authenticated;
GRANT ALL ON public.voice_participants TO service_role;

GRANT EXECUTE ON FUNCTION public.join_server_by_code(text) TO authenticated;