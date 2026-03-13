import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * PR-17: Capability boundary regression test.
 *
 * Ensures that:
 * 1. The daemon runtime does NOT depend on experimental modules
 * 2. CAPABILITY_CLASSIFICATION.md exists and is consistent
 * 3. README marks experimental capabilities correctly
 */

const ROOT = path.resolve(import.meta.dirname, '../../../../')
const DAEMON_RUNTIME = path.join(ROOT, 'packages/antigravity-daemon/src/runtime.ts')

describe('PR-17: capability boundary', () => {
  const runtimeSource = fs.readFileSync(DAEMON_RUNTIME, 'utf8')

  // ─── stable capabilities ARE in daemon runtime ────────────────────────

  it('daemon runtime imports DagEngine (stable)', () => {
    expect(runtimeSource).toContain('DagEngine')
  })

  it('daemon runtime imports GovernanceGateway (stable)', () => {
    expect(runtimeSource).toContain('GovernanceGateway')
  })

  it('daemon runtime imports JsonlEventStore (stable)', () => {
    expect(runtimeSource).toContain('JsonlEventStore')
  })

  it('daemon runtime imports AuthorityRuntimeKernel (stable)', () => {
    expect(runtimeSource).toContain('AuthorityRuntimeKernel')
  })

  it('daemon runtime imports RemoteWorkerDirectory (stable)', () => {
    expect(runtimeSource).toContain('RemoteWorkerDirectory')
  })

  it('daemon runtime imports TrustRegistryStore (stable)', () => {
    expect(runtimeSource).toContain('TrustRegistryStore')
  })

  // ─── experimental capabilities NOT in daemon default path ─────────────

  it('daemon runtime imports UpcastingEventStore (promoted to stable by PR-18)', () => {
    expect(runtimeSource).toContain('UpcastingEventStore')
  })

  it('daemon runtime does NOT import DagEngineTracer (experimental)', () => {
    expect(runtimeSource).not.toContain('DagEngineTracer')
  })

  it('daemon runtime does NOT import @opentelemetry (experimental)', () => {
    expect(runtimeSource).not.toContain('@opentelemetry')
  })

  it('daemon runtime does NOT import StateInvariantVerifier (experimental)', () => {
    expect(runtimeSource).not.toContain('StateInvariantVerifier')
  })

  it('daemon runtime does NOT import BoundedModelChecker (experimental)', () => {
    expect(runtimeSource).not.toContain('BoundedModelChecker')
  })

  // ─── CAPABILITY_CLASSIFICATION.md exists ──────────────────────────────

  it('CAPABILITY_CLASSIFICATION.md exists at repo root', () => {
    const classificationPath = path.join(ROOT, 'CAPABILITY_CLASSIFICATION.md')
    expect(fs.existsSync(classificationPath)).toBe(true)
  })

  // ─── README marks experimental items ──────────────────────────────────

  it('README marks observability as experimental', () => {
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')
    expect(readme).toContain('experimental')
    expect(readme).not.toContain('OpenTelemetry GenAI Semantic')
  })

  it('README does not claim Vector Search', () => {
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')
    expect(readme).not.toContain('Vector Search')
  })
})
