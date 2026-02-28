-- CoachOS Initial Schema
-- Run this once in Supabase Dashboard → SQL Editor (or use: supabase db push).
-- See supabase/README.md for instructions.

-- Table: profiles
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('coach', 'client')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Table: cases
CREATE TABLE cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES profiles(id),
  coach_id UUID NOT NULL REFERENCES profiles(id),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'closed')),
  drift_score FLOAT DEFAULT 0.0,
  overwhelm_score FLOAT DEFAULT 0.0,
  adherence_rate FLOAT DEFAULT 1.0,
  check_in_interval_hours INT DEFAULT 24,
  last_check_in_at TIMESTAMPTZ,
  awaiting_check_in BOOLEAN DEFAULT false,
  policies JSONB DEFAULT '{"ai_can_reorder_tasks":true,"ai_can_reduce_scope":true,"ai_can_change_goals":false,"ai_can_drop_tasks":false,"max_now_tasks":3,"escalation_drift_threshold":0.7,"escalation_failure_threshold":3,"min_check_in_interval_hours":12,"max_check_in_interval_hours":72}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Table: plans
CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id),
  goals JSONB DEFAULT '[]'::jsonb,
  weekly_focus TEXT DEFAULT '',
  version INT DEFAULT 1,
  change_summary TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Table: tasks
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id),
  plan_id UUID NOT NULL REFERENCES plans(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'done', 'stuck', 'dropped')),
  priority_bucket TEXT DEFAULT 'next' CHECK (priority_bucket IN ('now', 'next', 'later')),
  estimated_minutes INT,
  failure_count INT DEFAULT 0,
  order_index INT DEFAULT 0,
  deadline TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Table: check_ins
CREATE TABLE check_ins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id),
  completed_top_action BOOLEAN NOT NULL,
  blocker TEXT,
  free_text TEXT,
  ai_parsed_signals JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Table: escalations
CREATE TABLE escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id),
  trigger_reason TEXT NOT NULL,
  ai_summary TEXT NOT NULL,
  ai_recommendations JSONB DEFAULT '[]'::jsonb,
  what_ai_tried JSONB DEFAULT '[]'::jsonb,
  urgency TEXT DEFAULT 'routine' CHECK (urgency IN ('routine', 'urgent', 'critical')),
  coach_action TEXT CHECK (coach_action IN ('approved', 'overridden', 'resolved')),
  coach_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

-- Row-Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalations ENABLE ROW LEVEL SECURITY;

-- Profiles: users see own row, and can insert own row (for signup when trigger is blocked by RLS)
CREATE POLICY "Users see own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Cases: client sees own, coach sees assigned
CREATE POLICY "Client sees own case" ON cases FOR SELECT USING (auth.uid() = client_id);
CREATE POLICY "Coach sees assigned cases" ON cases FOR SELECT USING (auth.uid() = coach_id);
CREATE POLICY "Coach can update assigned cases" ON cases FOR UPDATE USING (auth.uid() = coach_id);
CREATE POLICY "Coach can insert cases" ON cases FOR INSERT WITH CHECK (auth.uid() = coach_id);

-- Plans: via case access
CREATE POLICY "Access plans via case" ON plans FOR SELECT USING (
  EXISTS (SELECT 1 FROM cases WHERE cases.id = plans.case_id AND (cases.client_id = auth.uid() OR cases.coach_id = auth.uid()))
);
CREATE POLICY "Insert plans via case" ON plans FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM cases WHERE cases.id = plans.case_id AND (cases.client_id = auth.uid() OR cases.coach_id = auth.uid()))
);
CREATE POLICY "Update plans via case" ON plans FOR UPDATE USING (
  EXISTS (SELECT 1 FROM cases WHERE cases.id = plans.case_id AND (cases.client_id = auth.uid() OR cases.coach_id = auth.uid()))
);

-- Tasks: via case access
CREATE POLICY "Access tasks via case" ON tasks FOR SELECT USING (
  EXISTS (SELECT 1 FROM cases WHERE cases.id = tasks.case_id AND (cases.client_id = auth.uid() OR cases.coach_id = auth.uid()))
);
CREATE POLICY "Insert tasks via case" ON tasks FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM cases WHERE cases.id = tasks.case_id AND (cases.client_id = auth.uid() OR cases.coach_id = auth.uid()))
);
CREATE POLICY "Update tasks via case" ON tasks FOR UPDATE USING (
  EXISTS (SELECT 1 FROM cases WHERE cases.id = tasks.case_id AND (cases.client_id = auth.uid() OR cases.coach_id = auth.uid()))
);

-- Check-ins: via case access (client inserts, both read)
CREATE POLICY "Access check_ins via case" ON check_ins FOR SELECT USING (
  EXISTS (SELECT 1 FROM cases WHERE cases.id = check_ins.case_id AND (cases.client_id = auth.uid() OR cases.coach_id = auth.uid()))
);
CREATE POLICY "Client inserts check_ins" ON check_ins FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM cases WHERE cases.id = check_ins.case_id AND cases.client_id = auth.uid())
);

-- Escalations: via case access
CREATE POLICY "Access escalations via case" ON escalations FOR SELECT USING (
  EXISTS (SELECT 1 FROM cases WHERE cases.id = escalations.case_id AND (cases.client_id = auth.uid() OR cases.coach_id = auth.uid()))
);
CREATE POLICY "Insert escalations via case" ON escalations FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM cases WHERE cases.id = escalations.case_id AND (cases.client_id = auth.uid() OR cases.coach_id = auth.uid()))
);
CREATE POLICY "Coach updates escalations" ON escalations FOR UPDATE USING (
  EXISTS (SELECT 1 FROM cases WHERE cases.id = escalations.case_id AND cases.coach_id = auth.uid())
);

-- Trigger: auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'coach')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
