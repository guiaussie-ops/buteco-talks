-- Bloco "Perfil e conta": bio no perfil e bucket de avatares.

-- BIO: recado curto no perfil. O limite mora no banco para o cliente não ser a
-- única barreira; 280 dá para se apresentar sem virar um textão.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bio text;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_bio_tamanho;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_bio_tamanho
  CHECK (bio IS NULL OR char_length(bio) <= 280);

-- As policies de profiles ("own profile read" / "update own profile") e o GRANT
-- de UPDATE já valem para a coluna nova, então não há RLS a acrescentar aqui.

-- AVATARES: bucket público na leitura (a foto aparece para a turma toda) e
-- gravação restrita ao dono.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars', 'avatars', true, 2097152,
  ARRAY['image/jpeg','image/png','image/webp','image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- O caminho do arquivo é "<user_id>/<arquivo>": a primeira pasta é a dona da
-- linha. É isso que impede alguém de sobrescrever o avatar dos outros.
DROP POLICY IF EXISTS "avatares leitura publica" ON storage.objects;
CREATE POLICY "avatares leitura publica" ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatar proprio insert" ON storage.objects;
CREATE POLICY "avatar proprio insert" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "avatar proprio update" ON storage.objects;
CREATE POLICY "avatar proprio update" ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "avatar proprio delete" ON storage.objects;
CREATE POLICY "avatar proprio delete" ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
