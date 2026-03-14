import { describe, expect, it } from 'vitest'
import { listToolCatalog, resolveEnabledDomains } from '../tool-registry.js'

describe('Antigravity MCP tool registry', () => {
  it('publishes the canonical task-kernel tool ids', () => {
    const names = listToolCatalog().map(tool => tool.name)
    const expectedModel = [
      'ai_ask',
      'ai_list_models',
      'ai_multi_ask',
      'ai_consensus',
    ]
    const expectedTask = [
      'task.run',
      'task.getState',
      'task.advance',
      'task.list',
      'task.cancel',
    ]

    expect(expectedModel.every(name => names.includes(name))).toBe(true)
    expect(expectedTask.every(name => names.includes(name))).toBe(true)
    expect(listToolCatalog(['task']).map(tool => tool.name).sort()).toEqual(expectedTask.sort())
  })

  it('filters enabled domains from environment-like input', () => {
    expect(resolveEnabledDomains('task')).toEqual(['task'])
    expect(resolveEnabledDomains('unknown')).toEqual(['model', 'task'])
  })
})
