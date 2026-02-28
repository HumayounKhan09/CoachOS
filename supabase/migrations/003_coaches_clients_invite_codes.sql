-- CoachOS: Split profiles into coaches/clients, add invite codes.
-- Run after 001 and 002. Migrates existing data then drops profiles.

-- 1. Create coaches table
CREATE TABLE coaches (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create clients table (coach_id links client to coach)
CREATE TABLE clients (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  coach_id UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX clients_coach_email_key ON clients (coach_id, email);

-- 3. Migrate coaches from profiles
INSERT INTO coaches (id, email, full_name)
SELECT id, email, full_name FROM profiles WHERE role = 'coach';

-- 4. Migrate clients from profiles (coach_id from their case)
INSERT INTO clients (id, coach_id, email, full_name)
SELECT p.id, (SELECT coach_id FROM cases WHERE cases.client_id = p.id LIMIT 1), p.email, p.full_name
FROM profiles p
WHERE p.role = 'client' AND EXISTS (SELECT 1 FROM cases WHERE cases.client_id = p.id);

-- 5. Create invite_codes table
CREATE TABLE invite_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  coach_id UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Update cases FKs to reference coaches and clients
ALTER TABLE cases DROP CONSTRAINT IF EXISTS cases_client_id_fkey;
ALTER TABLE cases DROP CONSTRAINT IF EXISTS cases_coach_id_fkey;
ALTER TABLE cases ADD CONSTRAINT cases_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE cases ADD CONSTRAINT cases_coach_id_fkey FOREIGN KEY (coach_id) REFERENCES coaches(id) ON DELETE CASCADE;

-- 7. RLS for coaches
ALTER TABLE coaches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Coaches see own row" ON coaches FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Coaches insert own row" ON coaches FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Coaches update own row" ON coaches FOR UPDATE USING (auth.uid() = id);

-- 8. RLS for clients
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clients see own row" ON clients FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Clients insert own row" ON clients FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Clients update own row" ON clients FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Coach sees own clients" ON clients FOR SELECT USING (
  EXISTS (SELECT 1 FROM coaches WHERE coaches.id = auth.uid() AND coaches.id = clients.coach_id)
);

-- 9. RLS for invite_codes (signup-client API uses service role to validate/update)
ALTER TABLE invite_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Coach manages own invite codes" ON invite_codes FOR ALL USING (
  coach_id = auth.uid()
);

-- 10. Drop old profile trigger and function
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- 11. Trigger: auto-create coach row when user signs up with role=coach (client signup is via API)
CREATE OR REPLACE FUNCTION public.handle_new_coach()
RETURNS TRIGGER AS $$
BEGIN
  IF COALESCE(NEW.raw_user_meta_data->>'role', '') = 'coach' THEN
    INSERT INTO public.coaches (id, email, full_name)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'full_name', '')
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_coach();

-- 12. Drop profiles table
DROP TABLE IF EXISTS profiles;
