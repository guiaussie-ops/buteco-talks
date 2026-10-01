-- Chat completo: edição, resposta, reações, menções, não lidas e imagens.
--
-- O "digitando…" não aparece aqui de propósito: ele viaja por broadcast do
-- Realtime e não grava nada no banco.

-- ============================================================================
-- MESSAGES: editar, responder e anexar imagem
-- ============================================================================

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS reply_to uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS image_path text;

-- Mensagem só de imagem pode ter texto vazio; sem imagem, texto é obrigatório.
-- NOT VALID: não reprova linha antiga, só as que entrarem daqui para frente.
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_texto_ou_imagem;
ALTER TABLE public.messages ADD CONSTRAINT messages_texto_ou_imagem
  CHECK (length(btrim(content)) > 0 OR image_path IS NOT NULL) NOT VALID;
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_tamanho;
ALTER TABLE public.messages ADD CONSTRAINT messages_tamanho
  CHECK (length(content) <= 4000) NOT VALID;

-- Editar mexe só no texto. Até aqui a policy "edit own messages" deixava a
-- pessoa trocar a mensagem de canal ou de data pela API; com o GRANT por
-- coluna, o resto da linha fica congelado depois do insert.
REVOKE UPDATE ON public.messages FROM authenticated;
GRANT UPDATE (content) ON public.messages TO authenticated;

CREATE OR REPLACE FUNCTION public.messages_guarda()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A hora é do servidor: é ela que decide o que conta como "não lida".
    NEW.created_at := now();
    NEW.edited_at := NULL;
    IF NEW.reply_to IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = NEW.reply_to AND m.channel_id = NEW.channel_id
    ) THEN
      RAISE EXCEPTION 'a resposta precisa ser na mesma mesa';
    END IF;
    -- O arquivo tem que estar na pasta da mesa e da própria pessoa; é o mesmo
    -- caminho que as policies do bucket conferem.
    IF NEW.image_path IS NOT NULL
       AND NEW.image_path NOT LIKE NEW.channel_id::text || '/' || NEW.user_id::text || '/%' THEN
      RAISE EXCEPTION 'imagem fora da pasta da mesa';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: o ON DELETE SET NULL do reply_to também passa por aqui, e não
  -- conta como edição.
  IF NEW.content IS DISTINCT FROM OLD.content THEN
    NEW.edited_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_guarda ON public.messages;
CREATE TRIGGER messages_guarda BEFORE INSERT OR UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_guarda();

-- Apagar mensagem dos outros passa do dono para dono + admins, como o resto
-- da gestão do buteco.
DROP POLICY IF EXISTS "delete own messages" ON public.messages;
CREATE POLICY "delete own messages" ON public.messages FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_server_admin(public.channel_server_id(channel_id), auth.uid()));

CREATE INDEX IF NOT EXISTS messages_reply_to_idx ON public.messages (reply_to) WHERE reply_to IS NOT NULL;

-- ============================================================================
-- REAÇÕES
-- ============================================================================

-- A chave primária composta é proposital: o Realtime manda no DELETE só as
-- colunas da chave, e com ela isso já é tudo que o cliente precisa saber.
CREATE TABLE IF NOT EXISTS public.message_reactions (
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  emoji text NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 16),
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS message_reactions_channel_idx ON public.message_reactions (channel_id);

-- channel_id é cópia da mensagem, guardada só para o filtro do Realtime. Quem
-- decide o valor é o banco, nunca o cliente.
CREATE OR REPLACE FUNCTION public.message_reactions_canal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT m.channel_id INTO NEW.channel_id FROM public.messages m WHERE m.id = NEW.message_id;
  IF NEW.channel_id IS NULL THEN
    RAISE EXCEPTION 'mensagem não existe';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.message_reactions_canal() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS message_reactions_canal ON public.message_reactions;
CREATE TRIGGER message_reactions_canal BEFORE INSERT ON public.message_reactions
  FOR EACH ROW EXECUTE FUNCTION public.message_reactions_canal();

GRANT SELECT, INSERT, DELETE ON public.message_reactions TO authenticated;
GRANT ALL ON public.message_reactions TO service_role;
ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "membros leem reacoes" ON public.message_reactions;
CREATE POLICY "membros leem reacoes" ON public.message_reactions FOR SELECT TO authenticated
  USING (public.is_server_member(public.channel_server_id(channel_id), auth.uid()));

DROP POLICY IF EXISTS "membros reagem" ON public.message_reactions;
CREATE POLICY "membros reagem" ON public.message_reactions FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_server_member(public.channel_server_id(channel_id), auth.uid())
  );

DROP POLICY IF EXISTS "tira a propria reacao" ON public.message_reactions;
CREATE POLICY "tira a propria reacao" ON public.message_reactions FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ============================================================================
-- NÃO LIDAS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.channel_reads (
  user_id uuid NOT NULL,
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel_id)
);

GRANT SELECT, INSERT, UPDATE ON public.channel_reads TO authenticated;
GRANT ALL ON public.channel_reads TO service_role;
ALTER TABLE public.channel_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cada um ve o que leu" ON public.channel_reads;
CREATE POLICY "cada um ve o que leu" ON public.channel_reads FOR SELECT TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS "cada um marca o que leu" ON public.channel_reads;
CREATE POLICY "cada um marca o que leu" ON public.channel_reads FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_server_member(public.channel_server_id(channel_id), auth.uid())
  );
DROP POLICY IF EXISTS "cada um atualiza o que leu" ON public.channel_reads;
CREATE POLICY "cada um atualiza o que leu" ON public.channel_reads FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Sem isto, no dia do deploy toda mesa de todo mundo acenderia com o
-- histórico inteiro como "não lido".
INSERT INTO public.channel_reads (user_id, channel_id, last_read_at)
SELECT m.user_id, c.id, now()
FROM public.server_members m
JOIN public.channels c ON c.server_id = m.server_id AND c.kind = 'text'
ON CONFLICT DO NOTHING;

-- Marca com a hora do servidor, para relógio errado no PC não esconder nem
-- ressuscitar mensagem. Nunca anda para trás.
CREATE OR REPLACE FUNCTION public.marcar_lida(_channel_id uuid)
RETURNS timestamptz LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  INSERT INTO public.channel_reads (user_id, channel_id, last_read_at)
  VALUES (auth.uid(), _channel_id, now())
  ON CONFLICT (user_id, channel_id)
    DO UPDATE SET last_read_at = GREATEST(public.channel_reads.last_read_at, EXCLUDED.last_read_at)
  RETURNING last_read_at;
$$;
REVOKE ALL ON FUNCTION public.marcar_lida(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_lida(uuid) TO authenticated;

-- Contagem por mesa de texto do buteco. A contagem para em 100 (o selo mostra
-- "99+"), para uma mesa esquecida não custar uma varredura inteira.
-- Menção é "@username" com fronteira dos dois lados, a mesma regra do cliente.
CREATE OR REPLACE FUNCTION public.nao_lidas(_server_id uuid)
RETURNS TABLE (channel_id uuid, nao_lidas int, mencoes int)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH eu AS (
    SELECT '(^|[^[:alnum:]_])@'
           || regexp_replace(p.username, '([^[:alnum:]_])', '\\\1', 'g')
           || '($|[^[:alnum:]_])' AS padrao
    FROM public.profiles p WHERE p.id = auth.uid()
  ),
  base AS (
    SELECT c.id, COALESCE(r.last_read_at, sm.joined_at) AS desde
    FROM public.channels c
    JOIN public.server_members sm ON sm.server_id = c.server_id AND sm.user_id = auth.uid()
    LEFT JOIN public.channel_reads r ON r.channel_id = c.id AND r.user_id = auth.uid()
    WHERE c.server_id = _server_id AND c.kind = 'text'
  )
  SELECT
    b.id,
    (SELECT count(*)::int FROM (
      SELECT 1 FROM public.messages m
      WHERE m.channel_id = b.id AND m.created_at > b.desde AND m.user_id <> auth.uid()
      LIMIT 100
    ) x),
    (SELECT count(*)::int FROM public.messages m, eu
      WHERE m.channel_id = b.id AND m.created_at > b.desde AND m.user_id <> auth.uid()
        AND m.content ~* eu.padrao)
  FROM base b;
$$;
REVOKE ALL ON FUNCTION public.nao_lidas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nao_lidas(uuid) TO authenticated;

-- ============================================================================
-- IMAGENS NO CHAT
-- ============================================================================

-- Bucket privado: a imagem só abre por URL assinada, e só para quem senta no
-- buteco. Caminho: "<channel_id>/<user_id>/<arquivo>".
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-images', 'chat-images', false, 8388608,
  ARRAY['image/jpeg','image/png','image/webp','image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Lê a mesa do caminho sem estourar erro de cast quando o nome não é um uuid:
-- um nome torto vira NULL, e NULL reprova a policy.
CREATE OR REPLACE FUNCTION public.chat_image_channel(_name text)
RETURNS uuid LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN split_part(_name, '/', 1) ~ '^[0-9a-fA-F-]{36}$' THEN split_part(_name, '/', 1)::uuid
  END;
$$;
GRANT EXECUTE ON FUNCTION public.chat_image_channel(text) TO authenticated;

DROP POLICY IF EXISTS "chat imagens leitura" ON storage.objects;
CREATE POLICY "chat imagens leitura" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-images'
    AND public.is_server_member(public.channel_server_id(public.chat_image_channel(name)), auth.uid())
  );

DROP POLICY IF EXISTS "chat imagens envio" ON storage.objects;
CREATE POLICY "chat imagens envio" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-images'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND public.is_server_member(public.channel_server_id(public.chat_image_channel(name)), auth.uid())
  );

DROP POLICY IF EXISTS "chat imagens apagar" ON storage.objects;
CREATE POLICY "chat imagens apagar" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-images'
    AND (
      (storage.foldername(name))[2] = auth.uid()::text
      OR public.is_server_admin(public.channel_server_id(public.chat_image_channel(name)), auth.uid())
    )
  );

-- ============================================================================
-- REALTIME
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'message_reactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;
  END IF;
END $$;
