-- Busca no chat de uma mesa de texto. Sem acento e sem caixa: "voce" acha
-- "Você". strpos em vez de LIKE para o termo não precisar escapar % e _.
--
-- SECURITY INVOKER de propósito: quem busca só acha o que o RLS de messages
-- já deixa ler. Sem índice por enquanto: o filtro por mesa usa o
-- messages_channel_created_idx e cada mesa é pequena.

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.buscar_mensagens(_channel_id uuid, _termo text)
RETURNS SETOF public.messages
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT m.*
  FROM public.messages m
  WHERE m.channel_id = _channel_id
    AND char_length(btrim(_termo)) >= 2
    AND strpos(
      extensions.unaccent(lower(m.content)),
      extensions.unaccent(lower(btrim(_termo)))
    ) > 0
  ORDER BY m.created_at DESC
  LIMIT 50;
$$;

REVOKE ALL ON FUNCTION public.buscar_mensagens(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.buscar_mensagens(uuid, text) TO authenticated;
