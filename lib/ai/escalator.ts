import { generateObject } from 'ai'
import { z } from 'zod'
import { getModel } from './config'

export const escalatorSchema = z.object({
  trigger_reason: z.string(),
  summary: z.string(),
  what_ai_tried: z.array(z.string()),
  recommendations: z.array(z.object({
    action: z.string(),
    rationale: z.string(),
  })),
  urgency: z.enum(['routine', 'urgent', 'critical']),
})

export type EscalatorOutput = z.infer<typeof escalatorSchema>

const SYSTEM_PROMPT = `You are the escalation writer for CoachOS. When the system detects a situation the AI cannot resolve alone, you create a clear packet for the human coach.

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

OUTPUT: Valid JSON only. No preamble, no markdown.`

export interface EscalatorContext {
  trigger_reason: string
  case_data: unknown
  tasks: unknown[]
  signals: unknown
  recent_check_ins: unknown[]
  what_ai_tried: string[]
}

export async function runEscalator(context: EscalatorContext): Promise<EscalatorOutput> {
  const { object } = await generateObject({
    model: getModel(),
    schema: escalatorSchema,
    mode: 'auto',
    system: SYSTEM_PROMPT,
    prompt: JSON.stringify(context),
  })

  return object
}
