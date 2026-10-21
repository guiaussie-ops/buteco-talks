-- Histórico da gestão: quem mexeu em quê no buteco. Cargo trocado, gente
-- expulsa, banida e desbanida, convites criados e revogados, link trocado,
-- quadro, nome do buteco e mesas. Quem entra por convite também fica anotado,
-- para saber qual convite trouxe quem.
--
-- Só o dono e os admins leem, pela RPC historico_da_gestao. Ninguém escreve
-- pela API: quem escreve são as próprias RPCs de gestão e alguns gatilhos.
--
-- Código de convite não vai inteiro para o histórico, só o final: admin que
-- não pode convidar não deve conseguir montar o link lendo o histórico.

CREATE TABLE IF NOT EXISTS public.acoes_da_gestao (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  server_id uuid NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  autor_id uuid,
  acao text NOT NULL,
  alvo_id uuid,
  detalhes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS acoes_da_gestao_server_idx ON public.acoes_da_gestao (server_id, id DESC);

REVOKE ALL ON public.acoes_da_gestao FROM anon, authenticated;
GRANT ALL ON public.acoes_da_gestao TO service_role;
ALTER TABLE public.acoes_da_gestao ENABLE ROW LEVEL SECURITY;

-- Anota uma ação. Uso interno: ninguém de fora chama.
-- Sem autor (migração, painel do Supabase) não anota: não é ação de ninguém
-- do buteco. Sem buteco (apagando em cascata) também não.
CREATE OR REPLACE FUNCTION public.registrar_acao(_server_id uuid, _acao text, _alvo_id uuid DEFAULT NULL, _detalhes jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.servers WHERE id = _server_id) THEN
    RETURN;
  END IF;
  INSERT INTO public.acoes_da_gestao (server_id, autor_id, acao, alvo_id, detalhes)
  VALUES (_server_id, auth.uid(), _acao, _alvo_id, coalesce(_detalhes, '{}'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.registrar_acao(uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- LEITURA
-- ============================================================================

-- Paginado pelo id, que só cresce: _antes_id é o id do último item que a
-- tela já tem. Pela data não dava, porque ações da mesma transação têm o
-- mesmo now() e uma delas sumiria na virada da página.
-- Os nomes vêm daqui porque autor e alvo podem nem estar mais no buteco
-- (banido, expulso), e aí a policy de profiles não mostraria.
CREATE OR REPLACE FUNCTION public.historico_da_gestao(_server_id uuid, _antes_id bigint DEFAULT NULL, _limite int DEFAULT 50)
RETURNS TABLE (
  id bigint,
  acao text,
  detalhes jsonb,
  created_at timestamptz,
  autor_id uuid,
  autor_nome text,
  autor_avatar text,
  alvo_id uuid,
  alvo_nome text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_server_admin(_server_id, auth.uid()) THEN
    RAISE EXCEPTION 'só o dono e os admins veem o histórico';
  END IF;
  RETURN QUERY
    SELECT a.id, a.acao, a.detalhes, a.created_at,
      a.autor_id, coalesce(pa.display_name, pa.username), pa.avatar_url,
      a.alvo_id, coalesce(pb.display_name, pb.username)
    FROM public.acoes_da_gestao a
    LEFT JOIN public.profiles pa ON pa.id = a.autor_id
    LEFT JOIN public.profiles pb ON pb.id = a.alvo_id
    WHERE a.server_id = _server_id AND (_antes_id IS NULL OR a.id < _antes_id)
    ORDER BY a.id DESC
    LIMIT least(greatest(coalesce(_limite, 50), 1), 200);
END;
$$;
REVOKE ALL ON FUNCTION public.historico_da_gestao(uuid, bigint, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.historico_da_gestao(uuid, bigint, int) TO authenticated;

-- Os banidos agora dizem também quem baniu. Mudar as colunas de retorno
-- exige apagar a função antes.
DROP FUNCTION IF EXISTS public.banidos(uuid);
CREATE FUNCTION public.banidos(_server_id uuid)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  username text,
  avatar_url text,
  reason text,
  created_at timestamptz,
  banned_by uuid,
  banned_by_name text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_server_admin(_server_id, auth.uid()) THEN
    RAISE EXCEPTION 'só o dono e os admins veem os banidos';
  END IF;
  RETURN QUERY
    SELECT b.user_id, p.display_name, p.username, p.avatar_url, b.reason, b.created_at,
      b.banned_by, coalesce(q.display_name, q.username)
    FROM public.server_bans b
    LEFT JOIN public.profiles p ON p.id = b.user_id
    LEFT JOIN public.profiles q ON q.id = b.banned_by
    WHERE b.server_id = _server_id
    ORDER BY b.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.banidos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.banidos(uuid) TO authenticated;
