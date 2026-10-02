-- Performance apontada pelo advisor do Supabase. Nenhuma regra de acesso muda.
--
-- 1. auth.uid() solto numa policy é reavaliado para CADA linha lida. Dentro de
--    um (select ...), o Postgres calcula uma vez por consulta (initplan). A
--    lógica de cada policy abaixo é idêntica à que estava no banco; só o
--    auth.uid() ganhou o select em volta. Gerado a partir de pg_policies.
--
-- 2. Índices para as buscas que a barra lateral e a lista de butecos fazem o
--    tempo todo e que hoje varrem a tabela inteira.

ALTER POLICY "admins apagam categorias" ON public.channel_categories
  USING (is_server_admin(server_id, (select auth.uid())));
ALTER POLICY "admins criam categorias" ON public.channel_categories
  WITH CHECK (is_server_admin(server_id, (select auth.uid())));
ALTER POLICY "admins mudam categorias" ON public.channel_categories
  USING (is_server_admin(server_id, (select auth.uid())))
  WITH CHECK (is_server_admin(server_id, (select auth.uid())));
ALTER POLICY "membros veem categorias" ON public.channel_categories
  USING (is_server_member(server_id, (select auth.uid())));

ALTER POLICY "cada um atualiza o que leu" ON public.channel_reads
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));
ALTER POLICY "cada um marca o que leu" ON public.channel_reads
  WITH CHECK (((user_id = (select auth.uid())) AND is_server_member(channel_server_id(channel_id), (select auth.uid()))));
ALTER POLICY "cada um ve o que leu" ON public.channel_reads
  USING ((user_id = (select auth.uid())));

ALTER POLICY "admins create channels" ON public.channels
  WITH CHECK (is_server_admin(server_id, (select auth.uid())));
ALTER POLICY "admins delete channels" ON public.channels
  USING (is_server_admin(server_id, (select auth.uid())));
ALTER POLICY "admins update channels" ON public.channels
  USING (is_server_admin(server_id, (select auth.uid())))
  WITH CHECK (is_server_admin(server_id, (select auth.uid())));
ALTER POLICY "members read channels" ON public.channels
  USING (is_server_member(server_id, (select auth.uid())));

ALTER POLICY "membros leem reacoes" ON public.message_reactions
  USING (is_server_member(channel_server_id(channel_id), (select auth.uid())));
ALTER POLICY "membros reagem" ON public.message_reactions
  WITH CHECK (((user_id = (select auth.uid())) AND is_server_member(channel_server_id(channel_id), (select auth.uid()))));
ALTER POLICY "tira a propria reacao" ON public.message_reactions
  USING ((user_id = (select auth.uid())));

ALTER POLICY "delete own messages" ON public.messages
  USING (((user_id = (select auth.uid())) OR is_server_moderator(channel_server_id(channel_id), (select auth.uid()))));
ALTER POLICY "edit own messages" ON public.messages
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));
ALTER POLICY "members read messages" ON public.messages
  USING (is_server_member(channel_server_id(channel_id), (select auth.uid())));
ALTER POLICY "members send messages" ON public.messages
  WITH CHECK (((user_id = (select auth.uid())) AND is_server_member(channel_server_id(channel_id), (select auth.uid()))));

ALTER POLICY "insert own profile" ON public.profiles
  WITH CHECK ((id = (select auth.uid())));
ALTER POLICY "own profile read" ON public.profiles
  USING (((id = (select auth.uid())) OR shares_server_with(id, (select auth.uid()))));
ALTER POLICY "update own profile" ON public.profiles
  USING ((id = (select auth.uid())))
  WITH CHECK ((id = (select auth.uid())));

ALTER POLICY "admins veem banidos" ON public.server_bans
  USING (is_server_admin(server_id, (select auth.uid())));

ALTER POLICY "admins revogam convites" ON public.server_invites
  USING (is_server_admin(server_id, (select auth.uid())));
ALTER POLICY "admins veem convites" ON public.server_invites
  USING (is_server_admin(server_id, (select auth.uid())));

ALTER POLICY "cada um sai quando quiser" ON public.server_members
  USING (((user_id = (select auth.uid())) AND (NOT is_server_owner(server_id, (select auth.uid())))));
ALTER POLICY "dono senta no proprio buteco" ON public.server_members
  WITH CHECK (((user_id = (select auth.uid())) AND (role = 'owner'::text) AND is_server_owner(server_id, (select auth.uid()))));
ALTER POLICY "read members of my servers" ON public.server_members
  USING (((user_id = (select auth.uid())) OR is_server_member(server_id, (select auth.uid()))));

ALTER POLICY "admins update server" ON public.servers
  USING (is_server_admin(id, (select auth.uid())))
  WITH CHECK (is_server_admin(id, (select auth.uid())));
ALTER POLICY "create server" ON public.servers
  WITH CHECK ((owner_id = (select auth.uid())));
ALTER POLICY "members read servers" ON public.servers
  USING (is_server_member(id, (select auth.uid())));
ALTER POLICY "owner delete server" ON public.servers
  USING ((owner_id = (select auth.uid())));

ALTER POLICY "join voice" ON public.voice_participants
  WITH CHECK (((user_id = (select auth.uid())) AND is_server_member(channel_server_id(channel_id), (select auth.uid())) AND (((camera_on = false) AND (screen_sharing = false)) OR is_adult((select auth.uid())))));
ALTER POLICY "leave voice" ON public.voice_participants
  USING ((user_id = (select auth.uid())));
ALTER POLICY "members read voice" ON public.voice_participants
  USING (is_server_member(channel_server_id(channel_id), (select auth.uid())));
ALTER POLICY "update own voice state" ON public.voice_participants
  USING ((user_id = (select auth.uid())))
  WITH CHECK (((user_id = (select auth.uid())) AND (((camera_on = false) AND (screen_sharing = false)) OR is_adult((select auth.uid())))));

-- A barra lateral carrega as mesas do buteco ordenadas por posição.
CREATE INDEX IF NOT EXISTS channels_server_position_idx ON public.channels (server_id, position);
CREATE INDEX IF NOT EXISTS channels_category_idx ON public.channels (category_id) WHERE category_id IS NOT NULL;
-- Apagar uma mesa apaga as marcas de leitura dela (ON DELETE CASCADE).
CREATE INDEX IF NOT EXISTS channel_reads_channel_idx ON public.channel_reads (channel_id);
-- "Meus butecos" busca server_members por user_id; o UNIQUE (server_id,
-- user_id) começa pela outra coluna e não serve para essa busca. O advisor não
-- aponta porque não é chave estrangeira.
CREATE INDEX IF NOT EXISTS server_members_user_idx ON public.server_members (user_id);
