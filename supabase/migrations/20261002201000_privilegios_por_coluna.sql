-- Conserta os privilégios das tabelas criadas desde 01/10.
--
-- O Supabase dá, por padrão (ALTER DEFAULT PRIVILEGES), TODOS os privilégios
-- em toda tabela nova do schema public para anon e authenticated. Um
-- `GRANT UPDATE (coluna)` depois disso não restringe nada: soma-se ao UPDATE
-- da tabela inteira que já estava lá. Para valer, precisa de REVOKE antes.
--
-- O que estava aberto de verdade pela API: o destinatário de uma mensagem
-- privada podia reescrever o texto e o remetente dela (a policy de UPDATE
-- existe para marcar como lida), quem votou num perfil podia mudar o voto de
-- pessoa, e um admin podia mudar uma categoria de buteco. As outras tabelas
-- ficam fechadas pelas policies, mas sem depender só delas.

REVOKE INSERT, UPDATE ON
  public.recados,
  public.votos_de_perfil,
  public.mensagens_privadas,
  public.channel_categories,
  public.message_reactions,
  public.server_bans,
  public.server_invites
FROM anon, authenticated;

GRANT INSERT (para_id, de_id, texto) ON public.recados TO authenticated;

GRANT INSERT (de_id, para_id, quesito, nivel) ON public.votos_de_perfil TO authenticated;
GRANT UPDATE (nivel, updated_at) ON public.votos_de_perfil TO authenticated;

GRANT INSERT (de_id, para_id, tipo, texto) ON public.mensagens_privadas TO authenticated;
GRANT UPDATE (lida_em) ON public.mensagens_privadas TO authenticated;

-- O id vai no insert porque o cliente gera os ids das duas primeiras
-- categorias ao abrir um buteco (para apontar as mesas para elas).
GRANT INSERT (id, server_id, name, position) ON public.channel_categories TO authenticated;
GRANT UPDATE (name, position) ON public.channel_categories TO authenticated;

GRANT INSERT (message_id, user_id, emoji, channel_id) ON public.message_reactions TO authenticated;

-- server_bans e server_invites: escrita só pelas RPCs (expulsar, criar_convite).

-- TRUNCATE, TRIGGER e REFERENCES nunca são usados pela API, e TRUNCATE passa
-- por cima do RLS. Não há motivo para quem usa o app ter nenhum dos três.
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- E a tabela de mensagens privadas não é coisa de visitante anônimo.
REVOKE ALL ON public.mensagens_privadas, public.recados, public.votos_de_perfil FROM anon;
