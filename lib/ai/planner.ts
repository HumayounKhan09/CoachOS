import { generateObject } from 'ai'
import { z } from 'zod'
import { getModel } from './config'

export const plannerSchema = z.object({
  weekly_focus: z.string(),
  goals: z.array(z.object({
    id: z.string().optional(),
    title: z.string(),
    description: z.string(),
    priority: z.enum(['high', 'medium', 'low']),
  })),
  task_updates: z.array(z.object({
    task_id: z.string().nullable(),
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
})

export type PlannerOutput = z.infer<typeof plannerSchema>

const SYSTEM_PROMPT = `You are the planning engine for CoachOS, an executive function coaching system.

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

OUTPUT: Valid JSON only. No preamble, no markdown.`

export interface PlannerContext {
  tasks: unknown[]
  goals: unknown[]
  recent_check_ins: unknown[]
  signals: unknown
  policies: unknown
  adherence_rate: number
  overwhelm_score: number
  trigger: 'brain_dump_confirm' | 'check_in'
}

export async function runPlanner(context: PlannerContext): Promise<PlannerOutput> {
  const { object } = await generateObject({
    model: getModel(),
    schema: plannerSchema,
    system: SYSTEM_PROMPT,
    prompt: JSON.stringify(context),
  })

  return object
}
