-- Perfil estilo Orkut: mural de recados, os votos de confiável / legal / sexy
-- e os butecos que duas pessoas frequentam em comum.
--
-- Quem vê o perfil de alguém é quem divide pelo menos um buteco com a pessoa,
-- a mesma regra que já vale para ler a linha dela em profiles.

-- ============================================================================
-- RECADOS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.recados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  para_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  de_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  texto text NOT NULL CHECK (char_length(btrim(texto)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (para_id <> de_id)
);
CREATE INDEX IF NOT EXISTS recados_para_idx ON public.recados (para_id, created_at DESC);
CREATE INDEX IF NOT EXISTS recados_de_idx ON public.recados (de_id);

GRANT SELECT, DELETE ON public.recados TO authenticated;
GRANT INSERT (para_id, de_id, texto) ON public.recados TO authenticated;
GRANT ALL ON public.recados TO service_role;
ALTER TABLE public.recados ENABLE ROW LEVEL SECURITY;

-- O mural é visível para quem divide buteco com o dono do perfil (e para os dois envolvidos).
DROP POLICY IF EXISTS "mural visivel pra quem divide buteco" ON public.recados;
CREATE POLICY "mural visivel pra quem divide buteco" ON public.recados FOR SELECT TO authenticated
  USING (
    para_id = (select auth.uid())
    OR de_id = (select auth.uid())
    OR public.shares_server_with(para_id, (select auth.uid()))
  );

DROP POLICY IF EXISTS "deixa recado pra quem divide buteco" ON public.recados;
CREATE POLICY "deixa recado pra quem divide buteco" ON public.recados FOR INSERT TO authenticated
  WITH CHECK (
    de_id = (select auth.uid())
    AND public.shares_server_with(para_id, (select auth.uid()))
  );

-- Apaga quem escreveu ou o dono do mural.
DROP POLICY IF EXISTS "apaga o proprio recado ou do proprio mural" ON public.recados;
CREATE POLICY "apaga o proprio recado ou do proprio mural" ON public.recados FOR DELETE TO authenticated
  USING (de_id = (select auth.uid()) OR para_id = (select auth.uid()));

-- ============================================================================
-- CONFIÁVEL / LEGAL / SEXY
-- ============================================================================

-- Cada pessoa dá de 1 a 3 em cada quesito para cada outra. O voto é secreto:
-- só quem votou lê a própria linha; o perfil mostra a média (notas_do_perfil).
CREATE TABLE IF NOT EXISTS public.votos_de_perfil (
  de_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  para_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  quesito text NOT NULL CHECK (quesito IN ('confiavel', 'legal', 'sexy')),
  nivel int NOT NULL CHECK (nivel BETWEEN 1 AND 3),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (de_id, para_id, quesito),
  CHECK (de_id <> para_id)
);
CREATE INDEX IF NOT EXISTS votos_de_perfil_para_idx ON public.votos_de_perfil (para_id);

GRANT SELECT, DELETE ON public.votos_de_perfil TO authenticated;
GRANT INSERT (de_id, para_id, quesito, nivel) ON public.votos_de_perfil TO authenticated;
GRANT UPDATE (nivel, updated_at) ON public.votos_de_perfil TO authenticated;
GRANT ALL ON public.votos_de_perfil TO service_role;
ALTER TABLE public.votos_de_perfil ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cada um ve o proprio voto" ON public.votos_de_perfil;
CREATE POLICY "cada um ve o proprio voto" ON public.votos_de_perfil FOR SELECT TO authenticated
  USING (de_id = (select auth.uid()));

DROP POLICY IF EXISTS "vota em quem divide buteco" ON public.votos_de_perfil;
CREATE POLICY "vota em quem divide buteco" ON public.votos_de_perfil FOR INSERT TO authenticated
  WITH CHECK (
    de_id = (select auth.uid())
    AND public.shares_server_with(para_id, (select auth.uid()))
  );

DROP POLICY IF EXISTS "muda o proprio voto" ON public.votos_de_perfil;
CREATE POLICY "muda o proprio voto" ON public.votos_de_perfil FOR UPDATE TO authenticated
  USING (de_id = (select auth.uid()))
  WITH CHECK (de_id = (select auth.uid()));

DROP POLICY IF EXISTS "tira o proprio voto" ON public.votos_de_perfil;
CREATE POLICY "tira o proprio voto" ON public.votos_de_perfil FOR DELETE TO authenticated
  USING (de_id = (select auth.uid()));

-- Média de cada quesito, de 0 a 3, e quantas pessoas votaram. Só para quem
-- pode ver o perfil (a própria pessoa ou quem divide buteco com ela).
CREATE OR REPLACE FUNCTION public.notas_do_perfil(_user_id uuid)
RETURNS TABLE (quesito text, media numeric, votos int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT q.quesito,
         COALESCE(round(avg(v.nivel), 1), 0) AS media,
         count(v.nivel)::int AS votos
  FROM (VALUES ('confiavel'), ('legal'), ('sexy')) AS q(quesito)
  LEFT JOIN public.votos_de_perfil v ON v.para_id = _user_id AND v.quesito = q.quesito
  WHERE _user_id = auth.uid() OR public.shares_server_with(_user_id, auth.uid())
  GROUP BY q.quesito;
$$;
REVOKE ALL ON FUNCTION public.notas_do_perfil(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notas_do_perfil(uuid) TO authenticated;

-- ============================================================================
-- FREQUENTA (butecos em comum)
-- ============================================================================

-- Só os butecos que EU também frequento: o perfil de alguém não pode virar um
-- jeito de descobrir butecos onde eu não entro.
CREATE OR REPLACE FUNCTION public.butecos_em_comum(_user_id uuid)
RETURNS TABLE (server_id uuid, name text, icon_emoji text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.name, s.icon_emoji
  FROM public.servers s
  JOIN public.server_members a ON a.server_id = s.id AND a.user_id = _user_id
  JOIN public.server_members b ON b.server_id = s.id AND b.user_id = auth.uid()
  ORDER BY s.name;
$$;
REVOKE ALL ON FUNCTION public.butecos_em_comum(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.butecos_em_comum(uuid) TO authenticated;
