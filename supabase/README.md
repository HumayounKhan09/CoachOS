# Supabase setup

Migrations in this folder **do not run automatically** on your hosted Supabase project. You need to apply them once.

## Option 1: Run in Supabase Dashboard (recommended)

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project.
2. Go to **SQL Editor**.
3. Open `supabase/migrations/001_initial_schema.sql` in this repo and copy its **entire** contents.
4. Paste into the SQL Editor and click **Run**.
5. You should see “Success” and the tables (`profiles`, `cases`, `plans`, `tasks`, `check_ins`, `escalations`) plus RLS policies and the `handle_new_user` trigger will be created.

If you get errors (e.g. “relation already exists”), some objects were already created. You can either create a new project and run the migration there, or fix the SQL (e.g. use `CREATE TABLE IF NOT EXISTS` or drop existing objects) and run again.

**If signup creates a user in Auth but no row in `profiles`:** run `supabase/migrations/002_profiles_insert_policy.sql` in the SQL Editor as well. The app will also create the profile after signup when this policy exists.

## Option 2: Supabase CLI

If you use the [Supabase CLI](https://supabase.com/docs/guides/cli):

1. Install: `npm install -g supabase` (or see [docs](https://supabase.com/docs/guides/cli)).
2. Link your project: `supabase link --project-ref YOUR_PROJECT_REF`  
   (Project ref is in Dashboard → Project Settings → General.)
3. Push migrations: `supabase db push`.

This applies all files in `supabase/migrations/` to the linked project.
