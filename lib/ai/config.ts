/**
 * AI model for Vercel AI SDK (generateObject, etc.).
 * Uses Vercel AI Gateway: one key (AI_GATEWAY_API_KEY), one model (AI_MODEL).
 * The SDK uses the gateway when model is a string; the assertion satisfies
 * AI SDK v3 types that expect LanguageModelV1.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getModel(): any {
  return process.env.AI_MODEL || 'anthropic/claude-sonnet-4-20250514'
}
