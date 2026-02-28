import { generateObject } from 'ai'
import { z } from 'zod'
import { getModel } from './config'

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
})

export type StructurerOutput = z.infer<typeof structurerSchema>

const SYSTEM_PROMPT = `You are the intake processor for CoachOS, an executive function coaching system.

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

OUTPUT: Valid JSON only. No preamble, no markdown.`

interface StructurerContext {
  existing_goals: unknown[]
  existing_now_tasks: unknown[]
  recent_sentiment: string
  days_since_last_brain_dump: number | null
}

export async function runStructurer(text: string, context: StructurerContext): Promise<StructurerOutput> {
  const { object } = await generateObject({
    model: getModel(),
    schema: structurerSchema,
    mode: 'auto',
    system: SYSTEM_PROMPT,
    prompt: JSON.stringify({
      brain_dump_text: text,
      context,
    }),
  })

  return object
}
