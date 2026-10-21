-- Encontros: hora marcada numa mesa. Quem cuida do buteco (dono e admins)
-- marca, muda e cancela; cada membro confirma se vai. O próximo encontro
-- aparece em destaque no salão, com o caminho direto para a mesa.
--
-- Cancelar não apaga: marca cancelado_em. Assim o histórico da gestão e as
-- confirmações continuam fazendo sentido, e quem abrir um link velho vê que
-- foi cancelado em vez de um "não existe".

CREATE TABLE IF NOT EXISTS public.encontros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  titulo text NOT NULL CHECK (char_length(btrim(titulo)) BETWEEN 1 AND 80),
  descricao text NOT NULL DEFAULT '' CHECK (char_length(descricao) <= 500),
  comeca_em timestamptz NOT NULL,
  -- Apagar a mesa não some com o encontro: ele fica sem mesa até alguém escolher outra.
  mesa_id uuid REFERENCES public.channels(id) ON DELETE SET NULL,
  criado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelado_em timestamptz
);
CREATE INDEX IF NOT EXISTS encontros_server_idx ON public.encontros (server_id, comeca_em);

-- server_id repetido aqui de propósito: o realtime só filtra por coluna da
-- própria linha, e é por buteco que a tela escuta.
CREATE TABLE IF NOT EXISTS public.presencas_em_encontros (
  encontro_id uuid NOT NULL REFERENCES public.encontros(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  server_id uuid NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  vou boolean NOT NULL DEFAULT true,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (encontro_id, user_id)
);
CREATE INDEX IF NOT EXISTS presencas_em_encontros_server_idx ON public.presencas_em_encontros (server_id);

-- Tabela nova nasce com tudo concedido: fecha, abre só a leitura. Escrita só pelas RPCs.
REVOKE ALL ON public.encontros, public.presencas_em_encontros FROM anon, authenticated;
GRANT SELECT ON public.encontros, public.presencas_em_encontros TO authenticated;
GRANT ALL ON public.encontros, public.presencas_em_encontros TO service_role;
ALTER TABLE public.encontros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presencas_em_encontros ENABLE ROW LEVEL SECURITY;

CREATE POLICY "membros veem os encontros" ON public.encontros FOR SELECT TO authenticated
  USING (public.is_server_member(server_id, (select auth.uid())));
CREATE POLICY "membros veem quem vai" ON public.presencas_em_encontros FOR SELECT TO authenticated
  USING (public.is_server_member(server_id, (select auth.uid())));

-- Marca (sem _id) ou muda (com _id) um encontro. A mesa tem que ser do buteco.
CREATE OR REPLACE FUNCTION public.salvar_encontro(
  _server_id uuid,
  _titulo text,
  _comeca_em timestamptz,
  _mesa_id uuid DEFAULT NULL,
  _descricao text DEFAULT '',
  _id uuid DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _novo uuid;
BEGIN
  IF NOT public.is_server_admin(_server_id, auth.uid()) THEN
    RAISE EXCEPTION 'só o dono e os admins marcam encontros';
  END IF;
  IF _mesa_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.channels WHERE id = _mesa_id AND server_id = _server_id
  ) THEN
    RAISE EXCEPTION 'mesa de outro buteco';
  END IF;

  IF _id IS NULL THEN
    INSERT INTO public.encontros (server_id, titulo, descricao, comeca_em, mesa_id, criado_por)
    VALUES (_server_id, btrim(_titulo), btrim(coalesce(_descricao, '')), _comeca_em, _mesa_id, auth.uid())
    RETURNING id INTO _novo;
    PERFORM public.registrar_acao(_server_id, 'marcou_encontro', NULL,
      jsonb_build_object('titulo', btrim(_titulo), 'comeca_em', _comeca_em));
    RETURN _novo;
  END IF;

  UPDATE public.encontros
    SET titulo = btrim(_titulo), descricao = btrim(coalesce(_descricao, '')),
        comeca_em = _comeca_em, mesa_id = _mesa_id
    WHERE id = _id AND server_id = _server_id AND cancelado_em IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'esse encontro não existe mais';
  END IF;
  PERFORM public.registrar_acao(_server_id, 'mudou_encontro', NULL,
    jsonb_build_object('titulo', btrim(_titulo), 'comeca_em', _comeca_em));
  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.salvar_encontro(uuid, text, timestamptz, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_encontro(uuid, text, timestamptz, uuid, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancelar_encontro(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _e public.encontros%ROWTYPE;
BEGIN
  SELECT * INTO _e FROM public.encontros WHERE id = _id;
  IF NOT FOUND OR NOT public.is_server_admin(_e.server_id, auth.uid()) THEN
    RAISE EXCEPTION 'só o dono e os admins cancelam encontros';
  END IF;
  IF _e.cancelado_em IS NOT NULL THEN
    RETURN;
  END IF;
  UPDATE public.encontros SET cancelado_em = now() WHERE id = _id;
  PERFORM public.registrar_acao(_e.server_id, 'cancelou_encontro', NULL,
    jsonb_build_object('titulo', _e.titulo, 'comeca_em', _e.comeca_em));
END;
$$;
REVOKE ALL ON FUNCTION public.cancelar_encontro(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancelar_encontro(uuid) TO authenticated;

-- "Vou" e "não vou mais". Só membro do buteco, e só em encontro de pé.
CREATE OR REPLACE FUNCTION public.confirmar_presenca(_encontro_id uuid, _vou boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _e public.encontros%ROWTYPE;
BEGIN
  SELECT * INTO _e FROM public.encontros WHERE id = _encontro_id;
  IF NOT FOUND OR NOT public.is_server_member(_e.server_id, auth.uid()) THEN
    RAISE EXCEPTION 'esse encontro não é do seu buteco';
  END IF;
  IF _e.cancelado_em IS NOT NULL THEN
    RAISE EXCEPTION 'esse encontro foi cancelado';
  END IF;
  INSERT INTO public.presencas_em_encontros (encontro_id, user_id, server_id, vou, atualizado_em)
  VALUES (_encontro_id, auth.uid(), _e.server_id, _vou, now())
  ON CONFLICT (encontro_id, user_id) DO UPDATE SET vou = EXCLUDED.vou, atualizado_em = now();
END;
$$;
REVOKE ALL ON FUNCTION public.confirmar_presenca(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirmar_presenca(uuid, boolean) TO authenticated;

-- Quem está no salão vê o encontro novo e as confirmações chegando.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['encontros', 'presencas_em_encontros'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
