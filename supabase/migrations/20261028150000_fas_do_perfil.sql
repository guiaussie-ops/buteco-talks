-- Fãs, à moda do Orkut: cada pessoa vira fã de quem divide buteco com ela, e o
-- perfil mostra quantos fãs tem. Como os votos de confiável / legal / sexy, é
-- secreto: cada um só lê a própria linha; a contagem sai por fas_do_perfil.

CREATE TABLE IF NOT EXISTS public.fas (
  de_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  para_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (de_id, para_id),
  CHECK (de_id <> para_id)
);
CREATE INDEX IF NOT EXISTS fas_para_idx ON public.fas (para_id);

-- Tabela nova nasce com tudo concedido: fecha antes de abrir por coluna.
REVOKE ALL ON public.fas FROM anon, authenticated;
GRANT SELECT, DELETE ON public.fas TO authenticated;
GRANT INSERT (de_id, para_id) ON public.fas TO authenticated;
GRANT ALL ON public.fas TO service_role;
ALTER TABLE public.fas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cada um ve de quem e fa" ON public.fas FOR SELECT TO authenticated
  USING (de_id = (select auth.uid()));

CREATE POLICY "vira fa de quem divide buteco" ON public.fas FOR INSERT TO authenticated
  WITH CHECK (
    de_id = (select auth.uid())
    AND public.shares_server_with(para_id, (select auth.uid()))
  );

CREATE POLICY "deixa de ser fa" ON public.fas FOR DELETE TO authenticated
  USING (de_id = (select auth.uid()));

-- Quantos fãs a pessoa tem. Só para quem pode ver o perfil.
CREATE OR REPLACE FUNCTION public.fas_do_perfil(_user_id uuid)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int
  FROM public.fas f
  WHERE f.para_id = _user_id
    AND (_user_id = auth.uid() OR public.shares_server_with(_user_id, auth.uid()));
$$;
REVOKE ALL ON FUNCTION public.fas_do_perfil(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fas_do_perfil(uuid) TO authenticated;
