/**
 * AI model for Vercel AI SDK (generateObject, etc.).
 * Uses Vercel AI Gateway: one key (AI_GATEWAY_API_KEY), one model (AI_MODEL).
 * The SDK uses the gateway automatically when model is a string.
 */
export function getModel(): string {
  return (
    process.env.AI_MODEL || 'anthropic/claude-sonnet-4-20250514'
  )
}
