import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * PR-20: Memory capability boundary regression tests.
 *
 * Verifies:
 * 1. VectorMemory is NOT exported from persistence barrel
 * 2. VectorMemory is NOT imported by daemon runtime
 * 3. CAPABILITY_CLASSIFICATION.md classifies VectorMemory as frozen
 * 4. Memory Manager is classified as experimental, not stable
 */
describe('PR-20: memory capability boundary', () => {
  // __tests__ → src → antigravity-daemon → packages → arkts-lsp
  const repoRoot = path.resolve(import.meta.dirname, '../../../..')

  it('VectorMemory is not exported from persistence barrel', async () => {
    const persistenceIndex = await import('@anthropic/antigravity-persistence')
    const exportedKeys = Object.keys(persistenceIndex)
    expect(exportedKeys).not.toContain('VectorMemory')
    expect(exportedKeys).not.toContain('VectorMemoryLayer')
  })

  it('daemon runtime.ts does not import VectorMemory', () => {
    const runtimePath = path.join(repoRoot, 'packages/antigravity-daemon/src/runtime.ts')
    const content = fs.readFileSync(runtimePath, 'utf-8')
    expect(content).not.toContain('VectorMemory')
    expect(content).not.toContain('VectorMemoryLayer')
  })

  it('CAPABILITY_CLASSIFICATION.md lists VectorMemory as frozen', () => {
    const classPath = path.join(repoRoot, 'CAPABILITY_CLASSIFICATION.md')
    const content = fs.readFileSync(classPath, 'utf-8')
    // Must be in the Frozen section
    const frozenIdx = content.indexOf('## Frozen')
    expect(frozenIdx).toBeGreaterThan(-1)
    const frozenSection = content.slice(frozenIdx)
    expect(frozenSection).toContain('VectorMemory')
    expect(frozenSection).toContain('VectorMemoryLayer')
  })

  it('CAPABILITY_CLASSIFICATION.md lists Memory Manager as experimental, not stable', () => {
    const classPath = path.join(repoRoot, 'CAPABILITY_CLASSIFICATION.md')
    const content = fs.readFileSync(classPath, 'utf-8')
    const stableIdx = content.indexOf('## Stable')
    const experimentalIdx = content.indexOf('## Experimental')
    const frozenIdx = content.indexOf('## Frozen')

    const stableSection = content.slice(stableIdx, experimentalIdx)
    const experimentalSection = content.slice(experimentalIdx, frozenIdx)

    expect(stableSection).not.toContain('Memory Manager')
    expect(experimentalSection).toContain('Memory Manager')
  })

  it('persistence barrel marks memory exports as @experimental', () => {
    const indexPath = path.join(repoRoot, 'packages/antigravity-persistence/src/index.ts')
    const content = fs.readFileSync(indexPath, 'utf-8')
    // The memory section should have @experimental comment
    expect(content).toContain('@experimental')
    expect(content).toContain('MemoryManager')
  })
})
