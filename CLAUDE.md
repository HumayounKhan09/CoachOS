# CoachOS — Claude Code Implementation Prompt

You are building CoachOS, a two-sided AI-native coaching platform. All architectural decisions have been made. Your job is to implement the full working prototype. Do not re-architect. Do not add features. Build exactly what is described below.

---

## CONTEXT: What has already been decided

A human designer and architect have spent extensive time planning this system. Here is every decision that has been locked in. Do not deviate from these choices.

### Stack (locked)
- **Framework:** Next.js 14+ with App Router (TypeScript)
- **Database:** Supabase (Postgres + Auth + RLS + Realtime)
- **AI:** Vercel AI SDK with provider-swappable models (Anthropic Claude Sonnet + OpenAI GPT-4o)
- **Styling:** Tailwind CSS + shadcn/ui components
- **Email:** Resend
- **Deployment:** Vercel
- **Cron:** Vercel Cron Functions

### Auth (locked)
- Supabase Auth with email/password
- Two roles: `coach` and `client`
- Coaches self-signup
- Clients enter ONLY through coach-initiated invite (magic link via `supabase.auth.admin.inviteUserByEmail()`)
- Every client always has a coach. Every case is always linked to both.
- Post-login routing: coach → `/dashboard`, client → `/today`

### AI architecture (locked)
- NOT agents. Three focused AI jobs called via Vercel AI SDK's `generateObject()` with Zod schemas.
- Provider is swappable via an `AI_PROVIDER` env var (`anthropic` or `openai`)
- The three jobs: **Structurer**, **Planner**, **Escalator**
- A fourth lightweight job: **Signal Parser** (runs inline during check-in processing)

### Core concept
> AI runs the daily coaching loop. Human coach supervises the exceptions queue.

The prototype must demonstrate ONE complete cycle:
1. Client dumps messy thoughts → AI structures into a plan
2. System checks in on client → AI adapts the plan
3. When adaptation fails repeatedly → AI stops and escalates
4. Coach reviews escalation and makes the judgment call

---

## WHAT TO BUILD: 5 screens, 6 tables, 10 API routes, 3 AI jobs

### Database: 6 tables

Create a Supabase migration file at `supabase/migrations/001_initial_schema.sql`.

#### Table: `profiles`
```sql
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('coach', 'client')),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

#### Table: `cases`
```sql
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
```

#### Table: `plans`
```sql
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
```

Goals shape: `[{"id":"uuid","title":"Pass midterm","description":"Score above 70%","priority":"high"}]`

#### Table: `tasks`
```sql
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
```

#### Table: `check_ins`
```sql
CREATE TABLE check_ins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id),
  completed_top_action BOOLEAN NOT NULL,
  blocker TEXT,
  free_text TEXT,
  ai_parsed_signals JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

ai_parsed_signals shape: `{"sentiment":"stressed","overwhelm_level":0.7,"avoidance_detected":true,"blocker_category":"task_too_big","notable_context":"Mentioned sleep issues"}`

#### Table: `escalations`
```sql
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
```

ai_recommendations shape: `[{"action":"Schedule a call","rationale":"Repeated failure suggests deeper issue"}]`
what_ai_tried shape: `["Reduced task from 30min to 15min","Increased check-in frequency"]`

#### Row-Level Security

Enable RLS on all tables. Create these policies:

```sql
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalations ENABLE ROW LEVEL SECURITY;

-- Profiles: users see own row
CREATE POLICY "Users see own profile" ON profiles FOR SELECT USING (auth.uid() = id);
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
```

#### Trigger: auto-create profile on signup

```sql
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
```

---

### API Routes: 10 total + 1 cron

Implement these as Next.js App Router route handlers.

For all routes that need the authenticated user, use the Supabase server client from `@supabase/ssr`. For admin operations (invite, cron), use the service role client.

#### 1. `POST /api/auth/invite` (Coach only)

Request: `{ "email": string, "full_name": string }`

Logic:
1. Verify caller role = coach (from session)
2. Call `supabase.auth.admin.inviteUserByEmail(email, { data: { full_name, role: 'client' } })`
3. Get the new user's ID from the invite response
4. Create a `cases` row: `{ client_id: newUserId, coach_id: callerUserId, status: 'active', policies: defaultPolicies }`
5. Return `{ success: true, case_id, client_id }`

Error if email already exists.

#### 2. `POST /api/brain-dump` (Client only)

Request: `{ "text": string }`

Logic:
1. Load client's case (via `client_id = auth.uid()`)
2. Load existing plan + goals + recent signals for context
3. Call AI Structurer (see AI Jobs section below)
4. Return the structured candidates — do NOT save to DB yet

Response:
```json
{
  "candidates": [
    {
      "temp_id": "temp_1",
      "type": "task",
      "title": "Study for biology midterm",
      "description": "Midterm is next Tuesday",
      "suggested_priority": "now",
      "estimated_minutes": 30,
      "deadline": "2026-03-03",
      "confidence": 0.95
    }
  ],
  "overall_sentiment": "stressed",
  "ambiguity_flags": ["Bank call purpose unclear"]
}
```

#### 3. `POST /api/brain-dump/confirm` (Client only)

Request:
```json
{
  "confirmed_candidates": [
    { "temp_id": "temp_1", "accepted": true, "title": "Study for biology midterm", "priority_bucket": "now", "estimated_minutes": 30, "deadline": "2026-03-03" },
    { "temp_id": "temp_2", "accepted": false }
  ]
}
```

Logic:
1. Load client's case
2. Create `tasks` rows for each accepted candidate
3. If a plan already exists: mark old plan `is_active = false`
4. Call AI Planner with new tasks + existing context
5. Create new `plans` row from Planner output
6. Return the plan + organized tasks

Response:
```json
{
  "plan": { "id": "uuid", "weekly_focus": "...", "version": 1, "change_summary": "..." },
  "tasks": {
    "now": [{ "id": "uuid", "title": "...", "estimated_minutes": 30, "status": "pending" }],
    "next": [...],
    "later": [...]
  }
}
```

#### 4. `GET /api/today` (Client only)

Logic:
1. Load client's case
2. Load active plan + tasks where `priority_bucket = 'now'` and `status IN ('pending', 'active')`, ordered by `order_index`, limited to `policies.max_now_tasks`
3. Return today view

Response:
```json
{
  "today_tasks": [
    { "id": "uuid", "title": "Study biology chapter 4", "estimated_minutes": 25, "status": "pending", "failure_count": 0 }
  ],
  "awaiting_check_in": false,
  "next_check_in_at": "2026-02-27T23:00:00Z",
  "weekly_focus": "Focus on midterm prep",
  "case_status": "active"
}
```

`next_check_in_at` = `last_check_in_at + check_in_interval_hours`. If `last_check_in_at` is null, use `created_at + 24h`.

#### 5. `PATCH /api/tasks/[id]` (Client for status, Coach for edits)

Request: `{ "status": "done" }` or `{ "status": "stuck" }` or `{ "priority_bucket": "later", "status": "dropped" }`

Logic:
- If `status = done`: set `completed_at = now()`
- If `status = stuck`: increment `failure_count` by 1
- If `failure_count` reaches `policies.escalation_failure_threshold` (default 3): auto-create escalation by calling AI Escalator
- Return updated task + whether escalation was created

Response: `{ "task": {...}, "escalation_created": false }`

#### 6. `GET /api/check-in` (Client only)

Logic:
1. Load client's case
2. If `awaiting_check_in = false`: return `{ "pending": false, "next_check_in_at": "..." }`
3. If `awaiting_check_in = true`: load the top "now" task and return check-in questions

Response (pending):
```json
{
  "pending": true,
  "top_task": { "id": "uuid", "title": "Study biology chapter 4" },
  "questions": {
    "q1": { "text": "Did you complete: Study biology chapter 4?", "type": "boolean" },
    "q2": { "text": "What got in the way?", "type": "single_select", "options": ["Too big","No time","Forgot","Didn't want to","Something came up","Other"], "conditional_on": {"q1": false} },
    "q3": { "text": "Anything else on your mind?", "type": "free_text", "optional": true }
  }
}
```

#### 7. `POST /api/check-in` (Client only)

Request:
```json
{
  "completed_top_action": false,
  "blocker": "Too big",
  "free_text": "The chapter is really long and I didn't know where to start"
}
```

This is the most complex endpoint. Logic:
1. Load client's case + active plan + tasks
2. Create `check_ins` row
3. Call AI Signal Parser to parse the response → save `ai_parsed_signals` on the check-in row
4. Update case: `last_check_in_at = now()`, `awaiting_check_in = false`
5. If `completed_top_action = false`: find the top "now" task, increment its `failure_count`
6. If `completed_top_action = true`: find the top "now" task, set `status = done`, `completed_at = now()`
7. Call AI Planner with updated context (tasks, signals, check-in data) → AI may shrink tasks, reorder, etc.
8. Archive old plan (`is_active = false`), create new plan version with Planner output
9. Recompute signals on the case:
   - `adherence_rate` = check-ins completed in last 7 days / expected check-ins
   - `drift_score` = compound formula (see Signal Computation below)
   - `overwhelm_score` = `ai_parsed_signals.overwhelm_level` from this check-in
10. Update case with new scores
11. Check escalation triggers: if `drift_score > policies.escalation_drift_threshold` OR `failure_count >= policies.escalation_failure_threshold` on any task → call AI Escalator, create escalation row
12. Compute new `check_in_interval_hours` (see Scheduling Logic below)

Response:
```json
{
  "updated_plan": { "change_summary": "Shrunk study task to 10 min.", "version": 2 },
  "updated_today_tasks": [{ "id": "uuid", "title": "Read chapter 4 summary only", "estimated_minutes": 10, "status": "pending" }],
  "signals": { "drift_score": 0.4, "overwhelm_score": 0.5, "adherence_rate": 0.6 },
  "escalation_created": false,
  "next_check_in_at": "2026-02-28T11:00:00Z",
  "ai_message": "No worries — I made it smaller. Just the summary, 10 minutes."
}
```

The `ai_message` comes from the Planner output — add a `client_message` field to the Planner schema for this.

#### 8. `GET /api/cases` (Coach only)

Query params: `?sort=drift|adherence|last_check_in|name&filter=all|needs_review|drifting|on_track|inactive`

Logic:
1. Load all cases where `coach_id = auth.uid()`
2. For each case, join to profiles to get client name
3. Compute `computed_status`:
   - `needs_review` = has unresolved escalation (escalation with `coach_action IS NULL`)
   - `drifting` = `drift_score > 0.5` and no unresolved escalation
   - `on_track` = `drift_score <= 0.5`
   - `inactive` = no check-in in 72+ hours and no unresolved escalation
4. Count pending escalations per case
5. Apply filter and sort
6. Return list + summary counts

Response:
```json
{
  "cases": [
    {
      "id": "uuid",
      "client_name": "Jane Student",
      "client_email": "jane@example.com",
      "computed_status": "needs_review",
      "drift_score": 0.8,
      "adherence_rate": 0.3,
      "overwhelm_score": 0.7,
      "last_check_in_at": "2026-02-26T19:00:00Z",
      "last_check_in_relative": "1 day ago",
      "pending_escalations": 1,
      "weekly_focus": "Midterm prep"
    }
  ],
  "summary": { "total": 8, "needs_review": 1, "drifting": 2, "on_track": 5, "inactive": 0 }
}
```

Use `date-fns` `formatDistanceToNow()` for `last_check_in_relative`.

#### 9. `GET /api/cases/[id]` (Coach only)

Logic: Load full case detail including plan, tasks (grouped by bucket), recent check-ins (last 7), signal history (last 14 days), and escalations.

Response:
```json
{
  "case": { "id": "uuid", "status": "active", "drift_score": 0.8, "overwhelm_score": 0.7, "adherence_rate": 0.3, "check_in_interval_hours": 12, "policies": {...} },
  "client": { "id": "uuid", "full_name": "Jane Student", "email": "jane@example.com" },
  "plan": { "id": "uuid", "goals": [...], "weekly_focus": "...", "version": 4, "change_summary": "..." },
  "tasks": { "now": [...], "next": [...], "later": [...], "done": [...] },
  "recent_check_ins": [...],
  "signal_history": [{ "type": "drift", "score": 0.8, "computed_at": "..." }],
  "escalations": [{ "id": "uuid", "trigger_reason": "...", "urgency": "urgent", "coach_action": null, "created_at": "..." }]
}
```

#### 10. `GET /api/escalations/[id]` (Coach only)

Response:
```json
{
  "escalation": {
    "id": "uuid",
    "trigger_reason": "Task 'Study for biology midterm' failed 3 times",
    "ai_summary": "Jane has attempted the biology study task three times over 4 days. Each time she reported it felt 'too big.' The system reduced from 30min to 15min to 10min. Pattern suggests avoidance or unclear done definition.",
    "what_ai_tried": ["Reduced task 30min → 15min", "Reduced to 10min", "Increased check-in frequency to 12h"],
    "ai_recommendations": [
      { "action": "Schedule a 15-min call to clarify blocking issue", "rationale": "Repeated 'too big' despite shrinking suggests real issue isn't size" },
      { "action": "Pause midterm goal and address overwhelm first", "rationale": "Overwhelm score is 0.7" }
    ],
    "urgency": "urgent",
    "coach_action": null,
    "coach_notes": null
  },
  "case_context": { "drift_score": 0.8, "overwhelm_score": 0.7, "adherence_rate": 0.3, "last_check_in_at": "..." }
}
```

#### 11. `PATCH /api/escalations/[id]` (Coach only)

Request: `{ "coach_action": "approved" | "overridden" | "resolved", "coach_notes": "optional text" }`

Logic:
1. Update escalation with `coach_action`, `coach_notes`, `resolved_at = now()`
2. Return updated escalation

#### 12. `GET /api/cron/daily-loop` (Vercel Cron — system only)

Verify `CRON_SECRET` from `Authorization` header.

Logic for each active case:
1. Count check-ins in last 7 days → compute `adherence_rate`
2. Compute `drift_score` (formula below)
3. Get latest check-in `ai_parsed_signals.overwhelm_level` → `overwhelm_score`
4. Insert signal rows into `signals` table (not created above — optionally track, or just update case directly; for the prototype, updating case directly is fine)
5. Update case: `drift_score`, `overwhelm_score`, `adherence_rate`
6. Compute `check_in_interval_hours` (formula below)
7. If hours since `last_check_in_at` >= `check_in_interval_hours`: set `awaiting_check_in = true`
8. If `drift_score > policies.escalation_drift_threshold`: call AI Escalator, create escalation
9. If no check-in in 5+ days: create escalation with trigger "Client inactive for 5+ days"

Response: `{ "processed": 12, "check_ins_triggered": 4, "escalations_created": 1 }`

---

### Signal computation formulas

```
ADHERENCE (7-day window):
  = check_ins_completed_in_7_days / expected_check_ins_in_7_days
  expected = floor(7 * 24 / check_in_interval_hours)
  If expected = 0, set to 1 to avoid division by zero

DRIFT (compound, capped at 1.0):
  base = 1.0 - adherence_rate
  + 0.1 * (number of tasks with failure_count >= 2)
  + 0.2 if no check-in in 48+ hours
  + 0.1 if last check-in sentiment = 'stressed' or 'overwhelmed'
  + 0.2 if last check-in sentiment = 'crisis'
  Math.min(result, 1.0)

CHECK-IN INTERVAL:
  if adherence > 0.8 AND drift < 0.3 → 48
  else if adherence < 0.5 OR drift > 0.5 → 12
  else → 24
  Clamp to [policies.min_check_in_interval_hours, policies.max_check_in_interval_hours]
```

---

### AI Jobs: implementation details

All AI jobs use the Vercel AI SDK. Create a shared config file for model selection.

#### `lib/ai/config.ts`

```typescript
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';

export function getModel() {
  const provider = process.env.AI_PROVIDER || 'anthropic';
  if (provider === 'openai') return openai('gpt-4o');
  return anthropic('claude-sonnet-4-20250514');
}
```

#### Job 1: Structurer (`lib/ai/structurer.ts`)

Called by `POST /api/brain-dump`.

System prompt:
```
You are the intake processor for CoachOS, an executive function coaching system.

Your job: take a client's raw brain dump and extract structured items.

RULES:
- Extract concrete, actionable tasks. Not vague intentions.
- Identify emotional signals: stress, overwhelm, avoidance, crisis.
- Identify constraints: deadlines, time limits, dependencies.
- Set confidence LOW (< 0.6) when information is vague or ambiguous.
- NEVER invent deadlines or details not stated or clearly implied.
- NEVER merge multiple distinct items into one task.
- Keep task titles short (under 10 words) and action-oriented ("Study for midterm", not "I need to study").
- Keep descriptions factual — only include what the client actually said.
- Suggested priorities: "now" = urgent/important, "next" = this week, "later" = can wait.
- If the client mentions feeling behind, overwhelmed, or uses crisis language, set overall_sentiment accordingly.
- Generate ambiguity_flags for anything you're unsure about.

CONTEXT: You receive the client's existing goals and recent signals to help with prioritization.

OUTPUT: Valid JSON only. No preamble, no markdown.
```

Context to include in the user message alongside the brain dump text:
```json
{
  "existing_goals": [...],
  "existing_now_tasks": [...],
  "recent_sentiment": "neutral",
  "days_since_last_brain_dump": 3
}
```

Zod output schema:
```typescript
import { z } from 'zod';

export const structurerSchema = z.object({
  candidates: z.array(z.object({
    temp_id: z.string(),
    type: z.enum(['task', 'signal', 'constraint']),
    title: z.string(),
    description: z.string().nullable(),
    suggested_priority: z.enum(['now', 'next', 'later']),
    estimated_minutes: z.number().nullable(),
    deadline: z.string().nullable(),
    confidence: z.number().min(0).max(1),
  })),
  overall_sentiment: z.enum(['positive', 'neutral', 'stressed', 'overwhelmed', 'crisis']),
  ambiguity_flags: z.array(z.string()),
});
```

#### Job 2: Planner (`lib/ai/planner.ts`)

Called by `POST /api/brain-dump/confirm` and `POST /api/check-in`.

System prompt:
```
You are the planning engine for CoachOS, an executive function coaching system.

CONTEXT YOU RECEIVE:
- Current tasks (with statuses, failure counts)
- Current plan goals (if any)
- Recent check-in data and signals
- Coach policies (guardrails you MUST respect)

RULES:
- "now" bucket: AT MOST {max_now_tasks} tasks (from policies). Fewer is better.
- Every "now" task should be completable in one sitting (under 60 min, ideally under 30).
- If a task has failed before: make it SMALLER.
- After a failed check-in: SHRINK scope. Never add more.
- If adherence_rate < 0.5: aggressively reduce. Move things to "later."
- If overwhelm_score > 0.6: reduce to ONE "now" task only.
- RESPECT POLICIES:
  - ai_can_change_goals = false → do NOT modify goals array
  - ai_can_drop_tasks = false → do NOT set status to "dropped"
  - ai_can_reduce_scope = true → may move tasks to "later"
  - ai_can_reorder_tasks = true → may change priority_bucket
- Always generate change_summary in plain language.
- weekly_focus: one sentence a stressed person can remember.
- client_message: a short, warm, encouraging message about the changes (1-2 sentences).
- recommended_check_in_hours: 12 if struggling, 24 normal, 48 if doing well.

OUTPUT: Valid JSON only. No preamble, no markdown.
```

Zod output schema:
```typescript
export const plannerSchema = z.object({
  weekly_focus: z.string(),
  goals: z.array(z.object({
    id: z.string().optional(),
    title: z.string(),
    description: z.string(),
    priority: z.enum(['high', 'medium', 'low']),
  })),
  task_updates: z.array(z.object({
    task_id: z.string().nullable(), // null = new task
    title: z.string(),
    description: z.string().nullable(),
    priority_bucket: z.enum(['now', 'next', 'later']),
    estimated_minutes: z.number(),
    status: z.enum(['pending', 'active', 'done', 'stuck', 'dropped']),
    rationale: z.string(),
  })),
  change_summary: z.string(),
  client_message: z.string(),
  recommended_check_in_hours: z.number(),
});
```

#### Job 3: Escalator (`lib/ai/escalator.ts`)

Called when: `failure_count >= 3` on any task, OR `drift_score > threshold`, OR `sentiment = crisis`, OR inactive 5+ days.

System prompt:
```
You are the escalation writer for CoachOS. When the system detects a situation the AI cannot resolve alone, you create a clear packet for the human coach.

CONTEXT YOU RECEIVE:
- The trigger reason
- Full case data: plan, tasks, signals, recent check-ins
- What AI adaptations have already been tried

RULES:
- Be factual. Not dramatic. Coaches need signal, not noise.
- Summary: ONE paragraph — what's happening, how long, what the pattern is.
- what_ai_tried: list specific actions already taken.
- Recommendations: COACH-LEVEL decisions (renegotiate goals, schedule a call, pause case) — NOT task-level.
- Never recommend anything outside coaching scope (no medical advice, no diagnoses).
- Urgency:
  - "routine" = pattern worth noting, no immediate risk
  - "urgent" = repeated failure, client may be disengaging
  - "critical" = crisis language detected, immediate attention needed
- Keep it short. Coach reads and decides in under 2 minutes.

OUTPUT: Valid JSON only. No preamble, no markdown.
```

Zod output schema:
```typescript
export const escalatorSchema = z.object({
  trigger_reason: z.string(),
  summary: z.string(),
  what_ai_tried: z.array(z.string()),
  recommendations: z.array(z.object({
    action: z.string(),
    rationale: z.string(),
  })),
  urgency: z.enum(['routine', 'urgent', 'critical']),
});
```

#### Job 4: Signal Parser (`lib/ai/signal-parser.ts`)

Lightweight. Called inline during `POST /api/check-in`.

System prompt:
```
You are a signal parser for CoachOS. Given a client's check-in response, extract structured signals.

INPUT: completed_top_action, blocker, free_text.
OUTPUT: JSON signals.

RULES:
- sentiment: based on language tone.
- overwhelm_level: 0.0–1.0.
- avoidance_detected: true if language suggests avoidance.
- blocker_category: task_too_big / no_time / forgot / low_motivation / external_event / unclear / none.
- notable_context: important detail for the coach. NULL if nothing notable.
- Be conservative. Don't over-interpret.
```

Zod output schema:
```typescript
export const signalParserSchema = z.object({
  sentiment: z.enum(['positive', 'neutral', 'stressed', 'overwhelmed', 'crisis']),
  overwhelm_level: z.number().min(0).max(1),
  avoidance_detected: z.boolean(),
  blocker_category: z.enum(['task_too_big', 'no_time', 'forgot', 'low_motivation', 'external_event', 'unclear', 'none']),
  notable_context: z.string().nullable(),
});
```

---

### Frontend: 5 screens + auth

Use the App Router route groups. Implement with Tailwind + shadcn/ui.

The design direction: **dark theme, minimal, utilitarian.** Use these color tokens:
- Background: `#0A0A0B`
- Surface: `#141416`
- Border: `#2A2A2E`
- Text: `#E8E8EC`
- Muted text: `#8A8A94`
- Accent: `#6C5CE7` (purple)
- Green: `#00D68F`
- Amber: `#FFAA00`
- Red: `#FF4757`

#### Folder structure

```
app/
├── (auth)/
│   ├── login/page.tsx
│   ├── signup/page.tsx
│   └── accept-invite/page.tsx
├── (client)/
│   ├── layout.tsx              ← bottom nav: Today, Brain Dump
│   ├── today/page.tsx
│   ├── brain-dump/page.tsx
│   └── check-in/page.tsx
├── (coach)/
│   ├── layout.tsx              ← sidebar nav: Dashboard, Invite
│   ├── dashboard/page.tsx
│   └── cases/[id]/page.tsx     ← includes escalation detail inline
├── api/
│   └── (all routes above)
├── layout.tsx
├── page.tsx                    ← redirect to /login
└── middleware.ts
```

#### Middleware (`middleware.ts`)

```
Public routes (skip auth): /login, /signup, /accept-invite
Protected routes:
  - /today, /brain-dump, /check-in → require role = client
  - /dashboard, /cases/* → require role = coach
Logic:
  1. Check Supabase session
  2. No session → redirect /login
  3. Has session → check role from profiles
  4. Role mismatch → redirect to correct home (client→/today, coach→/dashboard)
```

#### Screen 1: Client — Today (`/today`)

Fetch: `GET /api/today`

Shows:
- Header: "Today" + weekly focus (italic)
- Check-in banner (if `awaiting_check_in = true`): links to `/check-in`
- Task cards (1–3 max): each with title, estimated time, [Done ✓] and [Stuck ✗] buttons
- Footer: "Next check-in: {time}"
- Floating action button "+" → links to `/brain-dump`

Empty state (no plan): "Start with a brain dump to create your plan" + CTA button to `/brain-dump`
All done state: celebration message

[Done] → `PATCH /api/tasks/[id]` with `{ "status": "done" }` → remove card with animation
[Stuck] → `PATCH /api/tasks/[id]` with `{ "status": "stuck" }` → show toast "Got it — we'll adjust"

#### Screen 2: Client — Brain Dump (`/brain-dump`)

Three phases in one screen, managed with React state.

**Phase 1 — Input:** Large textarea + [Process →] button (disabled until text entered)
**Phase 2 — Review candidates:** Cards from `POST /api/brain-dump` response. Each card has:
  - Title, priority pill (tappable to cycle now→next→later), estimated time, confidence %
  - [✓] [✗] toggle buttons
  - If confidence < 0.7: amber border + "AI isn't sure about this one" + ambiguity text
  - [Confirm & Build Plan] button
**Phase 3 — Plan preview:** From `POST /api/brain-dump/confirm` response. Shows weekly focus + change summary. [Accept Plan ✓] → redirect to `/today`

#### Screen 3: Client — Check-in (`/check-in`)

Fetch: `GET /api/check-in` first to check if pending.

If not pending: show "No check-in right now. Next one at {time}." with back link.

If pending: multi-step form.
- **Step 1:** "Did you complete: {task title}?" [Yes] [No]
- **Step 2 (if No):** "What got in the way?" Chips: Too big, No time, Forgot, Didn't want to, Something came up. Optional text input.
- **Step 3:** "Anything else on your mind?" Optional textarea. [Submit Check-In]
- **Step 4 (result):** From `POST /api/check-in` response. Shows `ai_message`, plan changes, updated tasks, scores, next check-in time. [Go to Today →]

#### Screen 4: Coach — Queue Dashboard (`/dashboard`)

Fetch: `GET /api/cases`

Shows:
- Header: "Your Clients" + summary counts (total, needs review, drifting, on track)
- Filter chips: All, Needs Review, Drifting, On Track
- Case rows: each with left border colored by status (red/amber/green/gray), client name, status badge, drift score, adherence %, last check-in relative time, weekly focus, escalation count badge
- Click row → navigate to `/cases/[id]`
- Empty state: "No clients yet. Invite your first." + link to invite

Include an "Invite Client" section or button that opens a simple modal/form: email + name → `POST /api/auth/invite`

#### Screen 5: Coach — Case Detail + Escalation Review (`/cases/[id]`)

Fetch: `GET /api/cases/[id]`

This is ONE page with sections:

**Top bar:** Back link, client name, status badge, [Pause/Resume Case] button

**Score cards row:** Drift, Adherence, Overwhelm, Last Check-in (4 small cards)

**Plan section:** Goals list, weekly focus, tasks grouped by now/next/later. Coach can see task details but editing is v2 — read-only for prototype.

**Recent check-ins section:** Last 3-5 check-ins, each showing: completed_top_action (yes/no), blocker, free_text, parsed signals

**Escalation section (if any unresolved):** This is the KEY section. If there's an unresolved escalation, show it prominently:
- Urgency badge
- Trigger reason
- AI summary (paragraph)
- "What AI tried" (bulleted list)
- "AI recommends" (numbered list with action + rationale)
- Case context scores
- Coach notes textarea
- Action buttons: [Approve AI Rec] [Override] [Mark Resolved]
- On action → `PATCH /api/escalations/[id]` → show confirmation feedback

---

### Seed data

Create a seed script (`scripts/seed.ts` or `supabase/seed.sql`) that creates:

1. One coach: "Alex Rivera", coach@coachOS.demo, password: demo1234
2. Six clients with cases at different states:
   - **Jane Student** — needs_review, drift 0.8, adherence 0.3, has 1 urgent escalation (task failed 3x), 3 check-ins showing decline
   - **Mike Johnson** — drifting, drift 0.52, adherence 0.6, no escalation
   - **Sara Williams** — on_track, drift 0.12, adherence 0.92
   - **Alex Chen** — on_track, drift 0.08, adherence 0.95
   - **Priya Patel** — drifting, drift 0.45, adherence 0.55
   - **Tom Rivera** — inactive, no check-in in 5 days

3. Jane's full case data:
   - Plan: version 4, weekly focus "Midterm prep", goals: ["Pass midterm", "Get organized"]
   - Tasks: "Study biology chapter 4" (now, failure_count: 3, stuck), "Call the bank" (next), "Clean room" (later, done)
   - 5 check-ins over 4 days showing progressive failure
   - 1 unresolved escalation with full AI summary, what_ai_tried, recommendations

This seed data is critical for the demo. Jane's escalation is the centerpiece.

---

### Environment variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
AI_PROVIDER=anthropic
CRON_SECRET=
NEXT_PUBLIC_APP_URL=
```

### Vercel config

```json
{
  "crons": [
    {
      "path": "/api/cron/daily-loop",
      "schedule": "0 6 * * *"
    }
  ]
}
```

### Dependencies

```json
{
  "dependencies": {
    "next": "^14",
    "react": "^18",
    "react-dom": "^18",
    "@supabase/supabase-js": "^2",
    "@supabase/ssr": "^0",
    "ai": "^3",
    "@ai-sdk/anthropic": "^0",
    "@ai-sdk/openai": "^0",
    "zod": "^3",
    "date-fns": "^3"
  },
  "devDependencies": {
    "typescript": "^5",
    "tailwindcss": "^3",
    "@types/react": "^18",
    "@types/node": "^20"
  }
}
```

---

## BUILD ORDER

Build in this exact order for maximum demo impact:

### Step 1: Project setup
- `npx create-next-app@latest coachOS --typescript --tailwind --app --src-dir=false`
- Install all dependencies
- Set up Supabase project
- Run migration
- Configure env variables
- Set up Supabase client files (browser, server, admin)
- Deploy to Vercel immediately (deploy early, deploy often)

### Step 2: Auth
- Login page, signup page, accept-invite page
- Middleware for role-based routing
- Coach invite endpoint

### Step 3: Seed data
- Create the seed script with all 6 clients and Jane's full case data
- Run it so you have data to work with immediately

### Step 4: Coach dashboard + escalation review
- `GET /api/cases` + dashboard page
- `GET /api/cases/[id]` + `GET /api/escalations/[id]` + case detail page
- `PATCH /api/escalations/[id]` for resolve actions
- **Test this screen thoroughly — it's the demo centerpiece**

### Step 5: Brain dump → plan flow
- `POST /api/brain-dump` + AI Structurer
- `POST /api/brain-dump/confirm` + AI Planner
- Brain dump page with 3 phases

### Step 6: Check-in flow
- `GET /api/check-in` + `POST /api/check-in`
- AI Signal Parser + AI Planner re-run
- Check-in page with 4 steps
- Auto-escalation on failure threshold

### Step 7: Today screen
- `GET /api/today`
- `PATCH /api/tasks/[id]`
- Today page with task cards + check-in banner

### Step 8: Cron function
- `GET /api/cron/daily-loop`
- Signal computation + check-in scheduling

### Step 9: Polish
- Loading skeletons on all screens
- Empty states
- Error handling (toast notifications)
- Mobile-responsive client screens
- Final deploy + test

---

## IMPORTANT IMPLEMENTATION NOTES

1. **Use `generateObject()` from the Vercel AI SDK for all AI calls.** This gives you typed, schema-validated output. Never use `generateText()` and parse JSON manually.

2. **The service role client (`SUPABASE_SERVICE_ROLE_KEY`) bypasses RLS.** Use it ONLY in the cron function and the invite endpoint. Everything else uses the per-request authenticated client.

3. **For the prototype, skip email sending via Resend.** The cron job just sets `awaiting_check_in = true`. The client sees the banner on the Today screen. Email is a polish item.

4. **All timestamps should be in UTC.** Let the frontend handle timezone display.

5. **The `POST /api/check-in` endpoint is the most complex.** It does 12 things. Implement it step by step, test each part. Don't try to write it all at once.

6. **Jane's escalation is the demo.** Make sure the seed data creates a realistic, compelling escalation with detailed AI summary and recommendations. This single screen sells the entire concept.

7. **Error handling:** Every API route should return proper HTTP status codes and error messages. Every frontend page should handle loading and error states. Use try/catch on all AI calls — if AI fails, the system should degrade gracefully (show error, don't crash).

8. **Do not over-style.** The prototype uses a dark, minimal theme. Use Tailwind utility classes. Don't spend time on animations or hover effects. Clean and functional beats pretty and broken.
