-- Allow users to insert their own profile (so app can create profile after signup if trigger fails).
-- Run this in Supabase Dashboard → SQL Editor if signup creates auth user but no profile row.
CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);
