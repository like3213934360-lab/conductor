/**
 * PR-18: Daemon Upcasting Registry — event schema evolution registry.
 *
 * Registers all known upcasters for workflow events read by the daemon.
 * Called during daemon initialization to wrap JsonlEventStore with
 * UpcastingEventStore.
 */
import { UpcastingRegistry } from '@anthropic/antigravity-core'
import type { EventUpcaster } from '@anthropic/antigravity-core'

/**
 * NODE_COMPLETED v1 → v2 upcaster.
 *
 * v1 events may lack `elapsedMs` (the normalized duration alias).
 * v2 ensures `elapsedMs` is always present (defaulting from `durationMs` or 0).
 */
const nodeCompletedV1ToV2: EventUpcaster = {
  eventType: 'NODE_COMPLETED',
  fromSchemaVersion: 1,
  toSchemaVersion: 2,
  upcast(payload) {
    return {
      ...payload,
      elapsedMs: typeof payload.durationMs === 'number' ? payload.durationMs : 0,
    }
  },
}

/**
 * NODE_STARTED v1 → v2 upcaster.
 *
 * v1 events lack `startedAtMs` (epoch ms normalized from envelope timestamp).
 * v2 ensures `startedAtMs` is always present (defaults to 0 for legacy events).
 */
const nodeStartedV1ToV2: EventUpcaster = {
  eventType: 'NODE_STARTED',
  fromSchemaVersion: 1,
  toSchemaVersion: 2,
  upcast(payload) {
    return {
      ...payload,
      startedAtMs: 0, // legacy events lack epoch ms; consumers should prefer envelope.timestamp
    }
  },
}

/**
 * RUN_CREATED v1 → v2 upcaster.
 *
 * v1 events lack `createdAtMs` (epoch ms for duration calculation).
 * v2 ensures `createdAtMs` is always present (defaults to 0 for legacy events).
 */
const runCreatedV1ToV2: EventUpcaster = {
  eventType: 'RUN_CREATED',
  fromSchemaVersion: 1,
  toSchemaVersion: 2,
  upcast(payload) {
    return {
      ...payload,
      createdAtMs: 0, // legacy events lack epoch ms; consumers should prefer envelope.timestamp
    }
  },
}

/**
 * Create and return the daemon's upcasting registry with all known upcasters.
 */
export function createDaemonUpcastingRegistry(): UpcastingRegistry {
  const registry = new UpcastingRegistry()
  registry.registerAll([
    nodeCompletedV1ToV2,
    nodeStartedV1ToV2,
    runCreatedV1ToV2,
  ])
  return registry
}
