/**
 * Conductor AGC — Event Upcasting Pipeline
 *
 * Phase 4: 事件版本升级管线
 *
 * Event Sourcing 中，事件 schema 会随时间演化。
 * Upcaster 将旧版事件自动转换为当前版本，确保 projector 只需处理最新 schema。
 *
 * 设计参考:
 * - Axon Framework: event upcasting chain
 * - EventStoreDB: $by_event_type projection
 * - Greg Young: "versioning in an event sourced system" (2016)
 *
 * 安全设计:
 * 1. Upcaster 是纯函数 (无副作用)
 * 2. 版本号单调递增
 * 3. 链式执行 (v1 → v2 → v3 自动串联)
 */
import type { AGCEventEnvelope } from '@anthropic/conductor-shared'

/** 单个 Upcaster: 将事件从 fromVersion 升级到 toVersion */
export interface EventUpcaster {
  /** 适用的事件类型 */
  eventType: string
  /** 源版本 */
  fromSchemaVersion: number
  /** 目标版本 */
  toSchemaVersion: number
  /** 转换函数 (纯函数, 返回新 payload) */
  upcast(payload: Record<string, unknown>): Record<string, unknown>
}

/**
 * Upcasting Registry — 管理所有 upcaster 并自动链式升级
 */
export class UpcastingRegistry {
  /** eventType → version → upcaster */
  private readonly upcasters = new Map<string, Map<number, EventUpcaster>>()

  /** 注册 upcaster */
  register(upcaster: EventUpcaster): void {
    if (upcaster.toSchemaVersion <= upcaster.fromSchemaVersion) {
      throw new Error(
        `Upcaster 版本必须递增: ${upcaster.eventType} v${upcaster.fromSchemaVersion} → v${upcaster.toSchemaVersion}`,
      )
    }

    let typeMap = this.upcasters.get(upcaster.eventType)
    if (!typeMap) {
      typeMap = new Map()
      this.upcasters.set(upcaster.eventType, typeMap)
    }

    if (typeMap.has(upcaster.fromSchemaVersion)) {
      throw new Error(
        `重复的 upcaster: ${upcaster.eventType} v${upcaster.fromSchemaVersion}`,
      )
    }

    typeMap.set(upcaster.fromSchemaVersion, upcaster)
  }

  /** 批量注册 */
  registerAll(upcasters: EventUpcaster[]): void {
    for (const u of upcasters) {
      this.register(u)
    }
  }

  /**
   * 升级单个事件到最新版本
   *
   * 自动链式执行: v1 → v2 → v3
   * 如果无需升级, 返回原事件不变。
   */
  upcast(event: AGCEventEnvelope): AGCEventEnvelope {
    const typeMap = this.upcasters.get(event.type)
    if (!typeMap || typeMap.size === 0) return event

    // 从 payload 中提取 schemaVersion, 默认 1
    let currentVersion = typeof event.payload.schemaVersion === 'number'
      ? event.payload.schemaVersion
      : 1
    let payload = { ...event.payload }

    // 链式升级
    let maxIterations = 100 // 防止无限循环
    while (maxIterations-- > 0) {
      const upcaster = typeMap.get(currentVersion)
      if (!upcaster) break

      payload = upcaster.upcast(payload)
      currentVersion = upcaster.toSchemaVersion
      payload.schemaVersion = currentVersion
    }

    if (maxIterations <= 0) {
      throw new Error(`Upcaster 链超过 100 步, 可能存在循环: ${event.type}`)
    }

    return {
      ...event,
      payload,
    }
  }

  /**
   * 批量升级事件流
   */
  upcastAll(events: AGCEventEnvelope[]): AGCEventEnvelope[] {
    return events.map(e => this.upcast(e))
  }

  /** 获取某事件类型的最新 schema 版本 */
  getLatestVersion(eventType: string): number {
    const typeMap = this.upcasters.get(eventType)
    if (!typeMap || typeMap.size === 0) return 1

    let maxVersion = 1
    for (const upcaster of typeMap.values()) {
      if (upcaster.toSchemaVersion > maxVersion) {
        maxVersion = upcaster.toSchemaVersion
      }
    }
    return maxVersion
  }
}
