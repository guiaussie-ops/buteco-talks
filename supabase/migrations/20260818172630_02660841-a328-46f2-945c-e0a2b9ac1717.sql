-- PROFILES
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  display_name text NOT NULL,
  avatar_url text,
  birth_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- SERVERS
CREATE TABLE public.servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  icon_emoji text NOT NULL DEFAULT '#',
  owner_id uuid NOT NULL,
  invite_code text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(5), 'hex'),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.servers TO authenticated;
GRANT ALL ON public.servers TO service_role;
ALTER TABLE public.servers ENABLE ROW LEVEL SECURITY;

-- MEMBERS
CREATE TABLE public.server_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (server_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.server_members TO authenticated;
GRANT ALL ON public.server_members TO service_role;
ALTER TABLE public.server_members ENABLE ROW LEVEL SECURITY;

-- CHANNELS
CREATE TABLE public.channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text','voice')),
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channels TO authenticated;
GRANT ALL ON public.channels TO service_role;
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;

-- MESSAGES
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_channel_created_idx ON public.messages (channel_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- VOICE PARTICIPANTS
CREATE TABLE public.voice_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  muted boolean NOT NULL DEFAULT false,
  camera_on boolean NOT NULL DEFAULT false,
  screen_sharing boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_participants TO authenticated;
GRANT ALL ON public.voice_participants TO service_role;
ALTER TABLE public.voice_participants ENABLE ROW LEVEL SECURITY;

-- HELPERS
CREATE OR REPLACE FUNCTION public.is_server_member(_server_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.server_members m WHERE m.server_id = _server_id AND m.user_id = _user_id);
$$;

CREATE OR REPLACE FUNCTION public.is_server_owner(_server_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.servers s WHERE s.id = _server_id AND s.owner_id = _user_id);
$$;

CREATE OR REPLACE FUNCTION public.channel_server_id(_channel_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.server_id FROM public.channels c WHERE c.id = _channel_id;
$$;

CREATE OR REPLACE FUNCTION public.is_adult(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT p.birth_date IS NOT NULL AND p.birth_date <= (current_date - INTERVAL '18 years')
     FROM public.profiles p WHERE p.id = _user_id),
    false);
$$;

CREATE OR REPLACE FUNCTION public.shares_server_with(_other uuid, _me uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.server_members a
    JOIN public.server_members b ON a.server_id = b.server_id
    WHERE a.user_id = _other AND b.user_id = _me);
$$;

-- POLICIES: profiles
CREATE POLICY "own profile read" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR public.shares_server_with(id, auth.uid()));
CREATE POLICY "insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "update own profile" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- POLICIES: servers
CREATE POLICY "members read servers" ON public.servers FOR SELECT TO authenticated USING (public.is_server_member(id, auth.uid()));
CREATE POLICY "create server" ON public.servers FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "owner update server" ON public.servers FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "owner delete server" ON public.servers FOR DELETE TO authenticated USING (owner_id = auth.uid());

-- POLICIES: server_members
CREATE POLICY "read members of my servers" ON public.server_members FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_server_member(server_id, auth.uid()));
CREATE POLICY "join server" ON public.server_members FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "leave or owner removes" ON public.server_members FOR DELETE TO authenticated USING (user_id = auth.uid() OR public.is_server_owner(server_id, auth.uid()));

-- POLICIES: channels
CREATE POLICY "members read channels" ON public.channels FOR SELECT TO authenticated USING (public.is_server_member(server_id, auth.uid()));
CREATE POLICY "owner creates channels" ON public.channels FOR INSERT TO authenticated WITH CHECK (public.is_server_owner(server_id, auth.uid()));
CREATE POLICY "owner updates channels" ON public.channels FOR UPDATE TO authenticated USING (public.is_server_owner(server_id, auth.uid())) WITH CHECK (public.is_server_owner(server_id, auth.uid()));
CREATE POLICY "owner deletes channels" ON public.channels FOR DELETE TO authenticated USING (public.is_server_owner(server_id, auth.uid()));

-- POLICIES: messages
CREATE POLICY "members read messages" ON public.messages FOR SELECT TO authenticated USING (public.is_server_member(public.channel_server_id(channel_id), auth.uid()));
CREATE POLICY "members send messages" ON public.messages FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND public.is_server_member(public.channel_server_id(channel_id), auth.uid()));
CREATE POLICY "edit own messages" ON public.messages FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "delete own messages" ON public.messages FOR DELETE TO authenticated USING (user_id = auth.uid() OR public.is_server_owner(public.channel_server_id(channel_id), auth.uid()));

-- POLICIES: voice_participants (age gate on camera/screen)
CREATE POLICY "members read voice" ON public.voice_participants FOR SELECT TO authenticated USING (public.is_server_member(public.channel_server_id(channel_id), auth.uid()));
CREATE POLICY "join voice" ON public.voice_participants FOR INSERT TO authenticated WITH CHECK (
  user_id = auth.uid()
  AND public.is_server_member(public.channel_server_id(channel_id), auth.uid())
  AND ((camera_on = false AND screen_sharing = false) OR public.is_adult(auth.uid()))
);
CREATE POLICY "update own voice state" ON public.voice_participants FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (
  user_id = auth.uid()
  AND ((camera_on = false AND screen_sharing = false) OR public.is_adult(auth.uid()))
);
CREATE POLICY "leave voice" ON public.voice_participants FOR DELETE TO authenticated USING (user_id = auth.uid());

-- NEW USER TRIGGER
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name, birth_date)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'username', ''), split_part(NEW.email, '@', 1) || '_' || substr(NEW.id::text, 1, 4)),
    COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'display_name', ''), split_part(NEW.email, '@', 1)),
    NULLIF(NEW.raw_user_meta_data ->> 'birth_date', '')::date
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- REALTIME
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.voice_participants REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.voice_participants;