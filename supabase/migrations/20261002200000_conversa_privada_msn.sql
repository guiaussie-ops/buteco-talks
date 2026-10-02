-- Conversa privada estilo MSN, mais o status ("tomando uma", "ocupado",
-- "saiu pra fumar") e o subnick, a frase embaixo do nome.

-- ============================================================================
-- STATUS E SUBNICK
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'tomando_uma',
  ADD COLUMN IF NOT EXISTS subnick text;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_status_valido;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_status_valido
  CHECK (status IN ('tomando_uma', 'ocupado', 'saiu_pra_fumar', 'invisivel'));
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_subnick_tamanho;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_subnick_tamanho
  CHECK (subnick IS NULL OR char_length(subnick) <= 120);

-- ============================================================================
-- MENSAGENS PRIVADAS
-- ============================================================================

-- "atencao" é o "chamar atenção" do MSN: não tem texto, faz a janela de quem
-- recebe tremer. Fica gravado como mensagem para aparecer no histórico.
CREATE TABLE IF NOT EXISTS public.mensagens_privadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  de_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  para_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tipo text NOT NULL DEFAULT 'texto' CHECK (tipo IN ('texto', 'atencao')),
  texto text NOT NULL DEFAULT '' CHECK (char_length(texto) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  lida_em timestamptz,
  CHECK (de_id <> para_id),
  CHECK (tipo = 'atencao' OR char_length(btrim(texto)) > 0)
);
-- A conversa entre duas pessoas, nos dois sentidos, e as não lidas de quem recebe.
CREATE INDEX IF NOT EXISTS mensagens_privadas_par_idx
  ON public.mensagens_privadas (least(de_id, para_id), greatest(de_id, para_id), created_at DESC);
CREATE INDEX IF NOT EXISTS mensagens_privadas_para_idx
  ON public.mensagens_privadas (para_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mensagens_privadas_de_idx ON public.mensagens_privadas (de_id);

-- A hora é sempre a do servidor.
CREATE OR REPLACE FUNCTION public.mensagens_privadas_guarda()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.created_at := now();
  NEW.lida_em := NULL;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS mensagens_privadas_guarda ON public.mensagens_privadas;
CREATE TRIGGER mensagens_privadas_guarda BEFORE INSERT ON public.mensagens_privadas
  FOR EACH ROW EXECUTE FUNCTION public.mensagens_privadas_guarda();

GRANT SELECT ON public.mensagens_privadas TO authenticated;
GRANT INSERT (de_id, para_id, tipo, texto) ON public.mensagens_privadas TO authenticated;
GRANT UPDATE (lida_em) ON public.mensagens_privadas TO authenticated;
GRANT ALL ON public.mensagens_privadas TO service_role;
ALTER TABLE public.mensagens_privadas ENABLE ROW LEVEL SECURITY;

-- Só as duas pessoas da conversa leem. Nem dono de buteco, nem admin.
DROP POLICY IF EXISTS "so os dois leem" ON public.mensagens_privadas;
CREATE POLICY "so os dois leem" ON public.mensagens_privadas FOR SELECT TO authenticated
  USING (de_id = (select auth.uid()) OR para_id = (select auth.uid()));

-- Fala com quem divide pelo menos um buteco: não dá para mandar mensagem
-- para um estranho só sabendo o id dele.
DROP POLICY IF EXISTS "fala com quem divide buteco" ON public.mensagens_privadas;
CREATE POLICY "fala com quem divide buteco" ON public.mensagens_privadas FOR INSERT TO authenticated
  WITH CHECK (
    de_id = (select auth.uid())
    AND public.shares_server_with(para_id, (select auth.uid()))
  );

-- Só quem recebe marca como lida.
DROP POLICY IF EXISTS "quem recebe marca lida" ON public.mensagens_privadas;
CREATE POLICY "quem recebe marca lida" ON public.mensagens_privadas FOR UPDATE TO authenticated
  USING (para_id = (select auth.uid()))
  WITH CHECK (para_id = (select auth.uid()));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'mensagens_privadas'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.mensagens_privadas;
  END IF;
END $$;
