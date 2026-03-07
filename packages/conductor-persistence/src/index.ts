/**
 * Conductor AGC — conductor-persistence barrel export
 */

// Event Store
export { JsonlEventStore } from './event-store/jsonl-event-store.js'
export type { JsonlEventStoreConfig } from './event-store/jsonl-event-store.js'
export { appendJsonlLines, readJsonlStream, readLastJsonlLine, countJsonlLines } from './event-store/stream-utils.js'

// Checkpoint Store
export { SqliteCheckpointStore } from './checkpoint-store/sqlite-checkpoint-store.js'

// Database
export { SqliteClient } from './db/sqlite-client.js'
export type { SqliteClientConfig } from './db/sqlite-client.js'
export { runMigrations } from './db/migrations.js'

// Memory
export { MemoryManager } from './memory/memory-manager.js'
export type { MemoryManagerConfig, MemoryRecall } from './memory/memory-manager.js'
export { ManifestIndex } from './memory/manifest-index.js'
export type { ManifestEntry, ManifestSearchResult } from './memory/manifest-index.js'
export { EpisodicMemory } from './memory/episodic-memory.js'
export type { EpisodicEntry, ReflexionPrompt, ReflexionEvaluation, ReflexionReflection } from './memory/episodic-memory.js'
export { SemanticMemory } from './memory/semantic-memory.js'
export type { SemanticFact, FactQuery } from './memory/semantic-memory.js'

// File Lock — Phase 4 新增
export { FileLock, withFileLock } from './event-store/file-lock.js'
export type { FileLockOptions } from './event-store/file-lock.js'

// Upcasting EventStore — Phase 4 装饰器
export { UpcastingEventStore } from './event-store/upcasting-event-store.js'
