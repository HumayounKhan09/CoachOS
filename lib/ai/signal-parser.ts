import { generateObject } from 'ai'
import { z } from 'zod'
import { getModel } from './config'

export const signalParserSchema = z.object({
  sentiment: z.enum(['positive', 'neutral', 'stressed', 'overwhelmed', 'crisis']),
  overwhelm_level: z.number().min(0).max(1),
  avoidance_detected: z.boolean(),
  blocker_category: z.enum(['task_too_big', 'no_time', 'forgot', 'low_motivation', 'external_event', 'unclear', 'none']),
  notable_context: z.string().nullable(),
})

export type SignalParserOutput = z.infer<typeof signalParserSchema>

const SYSTEM_PROMPT = `You are a signal parser for CoachOS. Given a client's check-in response, extract structured signals.

INPUT: completed_top_action, blocker, free_text.
OUTPUT: JSON signals.

RULES:
- sentiment: based on language tone.
- overwhelm_level: 0.0–1.0.
- avoidance_detected: true if language suggests avoidance.
- blocker_category: task_too_big / no_time / forgot / low_motivation / external_event / unclear / none.
- notable_context: important detail for the coach. NULL if nothing notable.
- Be conservative. Don't over-interpret.`

interface SignalParserInput {
  completed_top_action: boolean
  blocker: string | null
  free_text: string | null
}

export async function runSignalParser(input: SignalParserInput): Promise<SignalParserOutput> {
  const { object } = await generateObject({
    model: getModel(),
    schema: signalParserSchema,
    mode: 'auto',
    system: SYSTEM_PROMPT,
    prompt: JSON.stringify(input),
  })

  return object
}
