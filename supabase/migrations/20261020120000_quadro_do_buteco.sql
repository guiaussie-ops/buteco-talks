-- Quadro do buteco: boas-vindas, regras e o aviso do dono, pendurados no
-- salão para todo mundo ver. Quem escreve é quem já cuida do buteco (dono e
-- admins), os mesmos que trocam o nome e arrumam as mesas.
--
-- Mora numa tabela própria, e não em colunas de servers, por causa do
-- realtime: o evento leva a linha inteira, e a linha de servers carrega o
-- invite_code, que membro nenhum pode ver.

CREATE TABLE IF NOT EXISTS public.quadro_do_buteco (
  server_id uuid PRIMARY KEY REFERENCES public.servers(id) ON DELETE CASCADE,
  boas_vindas text NOT NULL DEFAULT '' CHECK (char_length(boas_vindas) <= 600),
  regras text NOT NULL DEFAULT '' CHECK (char_length(regras) <= 2000),
  aviso text NOT NULL DEFAULT '' CHECK (char_length(aviso) <= 300),
  atualizado_por uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- Tabela nova nasce com tudo concedido: fecha antes, abre só a leitura.
-- Escrita só pela RPC salvar_quadro.
REVOKE ALL ON public.quadro_do_buteco FROM anon, authenticated;
GRANT SELECT ON public.quadro_do_buteco TO authenticated;
GRANT ALL ON public.quadro_do_buteco TO service_role;
ALTER TABLE public.quadro_do_buteco ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "membros leem o quadro" ON public.quadro_do_buteco;
CREATE POLICY "membros leem o quadro" ON public.quadro_do_buteco FOR SELECT TO authenticated
  USING (public.is_server_member(server_id, (select auth.uid())));

CREATE OR REPLACE FUNCTION public.salvar_quadro(_server_id uuid, _boas_vindas text, _regras text, _aviso text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_server_admin(_server_id, auth.uid()) THEN
    RAISE EXCEPTION 'só o dono e os admins escrevem no quadro';
  END IF;
  INSERT INTO public.quadro_do_buteco (server_id, boas_vindas, regras, aviso, atualizado_por, atualizado_em)
  VALUES (
    _server_id,
    btrim(coalesce(_boas_vindas, '')),
    btrim(coalesce(_regras, '')),
    btrim(coalesce(_aviso, '')),
    auth.uid(),
    now()
  )
  ON CONFLICT (server_id) DO UPDATE SET
    boas_vindas = EXCLUDED.boas_vindas,
    regras = EXCLUDED.regras,
    aviso = EXCLUDED.aviso,
    atualizado_por = EXCLUDED.atualizado_por,
    atualizado_em = EXCLUDED.atualizado_em;
END;
$$;
REVOKE ALL ON FUNCTION public.salvar_quadro(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_quadro(uuid, text, text, text) TO authenticated;

-- Quem está no salão vê o quadro mudar na hora.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'quadro_do_buteco'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.quadro_do_buteco;
  END IF;
END $$;
