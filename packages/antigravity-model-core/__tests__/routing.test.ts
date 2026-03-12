import { describe, expect, it } from 'vitest'
import type { AntigravityModelConfig } from '@anthropic/antigravity-model-shared'
import { resolveRoute } from '../src/routing.js'
import { multiAsk } from '../src/multi-ask.js'
import { consensus } from '../src/consensus.js'

function createConfig(): AntigravityModelConfig {
  return {
    version: 3,
    models: [
      {
        id: 'deepseek-primary',
        modelId: 'deepseek-chat',
        label: 'DeepSeek Primary',
        baseUrl: 'https://api.deepseek.com/v1',
        tasks: ['documentation', 'translation'],
        enabled: true,
        priority: 2,
        apiKey: 'sk-deepseek',
      },
      {
        id: 'claude-architect',
        modelId: 'claude-opus-4-6',
        label: 'Claude Architect',
        baseUrl: 'https://api.anthropic.com/v1',
        tasks: ['architecture', 'agentic'],
        enabled: true,
        priority: 1,
        apiKey: 'sk-claude',
      },
    ],
  }
}

describe('resolveRoute', () => {
  it('routes only against the configured model catalog', () => {
    const route = resolveRoute('design the system architecture for this daemon', createConfig())

    expect(route).not.toBeNull()
    expect(route?.label).toBe('Claude Architect')
    expect(route?.modelId).toBe('claude-opus-4-6')
  })

  it('supports forced model hints without a provider fallback table', () => {
    const route = resolveRoute('translate this text', createConfig(), 'deepseek')

    expect(route).not.toBeNull()
    expect(route?.label).toBe('DeepSeek Primary')
    expect(route?.modelId).toBe('deepseek-chat')
  })

  it('returns null when the catalog has no enabled models', () => {
    const route = resolveRoute('anything', { version: 3, models: [] })
    expect(route).toBeNull()
  })
})

describe('catalog-only multi-model entrypoints', () => {
  const emptyConfig: AntigravityModelConfig = { version: 3, models: [] }

  it('requires configured models for multiAsk', async () => {
    await expect(multiAsk({ message: 'hello', config: emptyConfig })).rejects.toThrow('No enabled models configured.')
  })

  it('requires configured models for consensus', async () => {
    await expect(consensus({ message: 'hello', config: emptyConfig })).rejects.toThrow('No enabled models configured.')
  })
})
