/**
 * AI model for Vercel AI SDK (generateObject, etc.).
 * Uses Anthropic provider with Vercel AI Gateway: one key (AI_GATEWAY_API_KEY), one model (AI_MODEL).
 * Returning a real model instance ensures generateObject works (string models can lack object generation mode).
 */
import { createAnthropic } from '@ai-sdk/anthropic'

const gatewayBaseUrl = 'https://ai-gateway.vercel.sh'
const defaultModelId = 'claude-sonnet-4-20250514'

function getModelId(): string {
  const raw = process.env.AI_MODEL || `anthropic/${defaultModelId}`
  return raw.replace(/^anthropic\/?/i, '') || defaultModelId
}

let _model: ReturnType<ReturnType<typeof createAnthropic>> | null = null

export function getModel() {
  if (_model) return _model
  const gatewayKey = process.env.AI_GATEWAY_API_KEY
  const anthropic = createAnthropic({
    apiKey: gatewayKey || process.env.ANTHROPIC_API_KEY || undefined,
    baseURL: gatewayKey ? gatewayBaseUrl : undefined,
  })
  _model = anthropic(getModelId())
  return _model
}
