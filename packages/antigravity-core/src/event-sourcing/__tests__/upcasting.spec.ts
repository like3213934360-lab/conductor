/**
 * upcasting.spec.ts — Event Upcasting Pipeline 单元测试
 */
import { describe, it, expect } from 'vitest'
import { UpcastingRegistry } from '../upcasting.js'
import type { WorkflowEventEnvelope } from '@anthropic/antigravity-shared'

function createEvent(type: string, payload: Record<string, unknown>): WorkflowEventEnvelope {
  return {
    eventId: 'test-event',
    runId: 'test-run',
    type,
    payload,
    timestamp: new Date().toISOString(),
    version: 1,
  }
}

describe('UpcastingRegistry', () => {
  it('无 upcaster 时返回原事件', () => {
    const registry = new UpcastingRegistry()
    const event = createEvent('TEST', { data: 'hello' })
    const result = registry.upcast(event)
    expect(result).toEqual(event)
  })

  it('应正确执行单步升级', () => {
    const registry = new UpcastingRegistry()
    registry.register({
      eventType: 'TEST',
      fromSchemaVersion: 1,
      toSchemaVersion: 2,
      upcast: (payload) => ({ ...payload, newField: 'added' }),
    })

    const event = createEvent('TEST', { data: 'hello', schemaVersion: 1 })
    const result = registry.upcast(event)
    expect(result.payload.newField).toBe('added')
    expect(result.payload.schemaVersion).toBe(2)
  })

  it('应正确执行链式升级 v1 → v2 → v3', () => {
    const registry = new UpcastingRegistry()
    registry.registerAll([
      {
        eventType: 'TEST',
        fromSchemaVersion: 1,
        toSchemaVersion: 2,
        upcast: (p) => ({ ...p, v2Field: true }),
      },
      {
        eventType: 'TEST',
        fromSchemaVersion: 2,
        toSchemaVersion: 3,
        upcast: (p) => ({ ...p, v3Field: 'final' }),
      },
    ])

    const event = createEvent('TEST', { data: 'hello', schemaVersion: 1 })
    const result = registry.upcast(event)
    expect(result.payload.v2Field).toBe(true)
    expect(result.payload.v3Field).toBe('final')
    expect(result.payload.schemaVersion).toBe(3)
  })

  it('版本递减应抛错', () => {
    const registry = new UpcastingRegistry()
    expect(() => registry.register({
      eventType: 'TEST',
      fromSchemaVersion: 2,
      toSchemaVersion: 1,
      upcast: (p) => p,
    })).toThrow()
  })

  it('重复注册应抛错', () => {
    const registry = new UpcastingRegistry()
    const upcaster = {
      eventType: 'TEST',
      fromSchemaVersion: 1,
      toSchemaVersion: 2,
      upcast: (p: Record<string, unknown>) => p,
    }
    registry.register(upcaster)
    expect(() => registry.register(upcaster)).toThrow('重复')
  })

  it('getLatestVersion 应返回最高版本', () => {
    const registry = new UpcastingRegistry()
    registry.registerAll([
      { eventType: 'TEST', fromSchemaVersion: 1, toSchemaVersion: 2, upcast: (p) => p },
      { eventType: 'TEST', fromSchemaVersion: 2, toSchemaVersion: 5, upcast: (p) => p },
    ])
    expect(registry.getLatestVersion('TEST')).toBe(5)
    expect(registry.getLatestVersion('UNKNOWN')).toBe(1)
  })

  it('upcastAll 应批量升级', () => {
    const registry = new UpcastingRegistry()
    registry.register({
      eventType: 'TEST',
      fromSchemaVersion: 1,
      toSchemaVersion: 2,
      upcast: (p) => ({ ...p, upgraded: true }),
    })

    const events = [
      createEvent('TEST', { schemaVersion: 1 }),
      createEvent('OTHER', { schemaVersion: 1 }),
    ]
    const results = registry.upcastAll(events)
    expect(results[0]!.payload.upgraded).toBe(true)
    expect(results[1]!.payload.upgraded).toBeUndefined() // OTHER 不受影响
  })
})
