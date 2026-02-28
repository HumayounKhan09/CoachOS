/**
 * AI model for generateObject (structurer, planner, escalator, etc.).
 * Uses the AI SDK with a single model from env: set AI_MODEL (e.g. anthropic/claude-sonnet-4-20250514)
 * and one of AI_GATEWAY_API_KEY or ANTHROPIC_API_KEY. The model is passed into generateObject
 * via getModel() so you can switch models without touching call sites.
 */
import { createAnthropic } from '@ai-sdk/anthropic'

const defaultModelId = 'claude-sonnet-4-20250514'

function getModelId(): string {
  const raw = process.env.AI_MODEL || `anthropic/${defaultModelId}`
  return raw.replace(/^anthropic\/?/i, '') || defaultModelId
}

let _model: ReturnType<ReturnType<typeof createAnthropic>> | null = null

export function getModel() {
  if (_model) return _model
  const gatewayKey = process.env.AI_GATEWAY_API_KEY
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const apiKey = gatewayKey || anthropicKey
  if (!apiKey?.trim()) {
    throw new Error(
      'Missing AI API key: set AI_GATEWAY_API_KEY or ANTHROPIC_API_KEY in your environment.'
    )
  }
  const anthropic = createAnthropic({
    apiKey,
    baseURL: gatewayKey ? 'https://ai-gateway.vercel.sh/v1' : undefined,
  })
  _model = anthropic(getModelId())
  return _model
}
