import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * PR-21: Benchmark / Interop / Formal capability boundary regression.
 *
 * Verifies:
 * 1. Formal verifiers are NOT imported by daemon runtime
 * 2. CAPABILITY_CLASSIFICATION.md labels benchmark as internal harness
 * 3. CAPABILITY_CLASSIFICATION.md labels formal verifiers as conformance assets
 * 4. Core exports mark formal verifiers as @experimental
 * 5. Benchmark/interop are in experimental section, not stable
 */
describe('PR-21: benchmark/interop/formal boundary', () => {
  // __tests__ → src → antigravity-daemon → packages → arkts-lsp
  const repoRoot = path.resolve(import.meta.dirname, '../../../..')

  it('daemon runtime.ts does not import formal verifiers', () => {
    const runtimePath = path.join(repoRoot, 'packages/antigravity-daemon/src/runtime.ts')
    const content = fs.readFileSync(runtimePath, 'utf-8')
    expect(content).not.toContain('StateInvariantVerifier')
    expect(content).not.toContain('BoundedModelChecker')
  })

  it('classification lists benchmark as internal harness, not stable', () => {
    const classPath = path.join(repoRoot, 'CAPABILITY_CLASSIFICATION.md')
    const content = fs.readFileSync(classPath, 'utf-8')
    const stableIdx = content.indexOf('## Stable')
    const experimentalIdx = content.indexOf('## Experimental')

    const stableSection = content.slice(stableIdx, experimentalIdx)
    expect(stableSection).not.toContain('Benchmark')

    const experimentalSection = content.slice(experimentalIdx)
    expect(experimentalSection).toContain('Benchmark Harness')
    expect(experimentalSection).toContain('Internal evaluation harness')
  })

  it('classification lists formal verifiers as conformance assets', () => {
    const classPath = path.join(repoRoot, 'CAPABILITY_CLASSIFICATION.md')
    const content = fs.readFileSync(classPath, 'utf-8')
    expect(content).toContain('Conformance asset')
    expect(content).toContain('StateInvariantVerifier')
    expect(content).toContain('BoundedModelChecker')
  })

  it('core barrel exports mark formal verifiers as @experimental', () => {
    const indexPath = path.join(repoRoot, 'packages/antigravity-core/src/index.ts')
    const content = fs.readFileSync(indexPath, 'utf-8')
    // Both formal verifier exports should have @experimental comment above them
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.includes('StateInvariantVerifier') || lines[i]!.includes('BoundedModelChecker')) {
        // Check that at least one preceding line within 3 lines has @experimental
        const preceding = lines.slice(Math.max(0, i - 3), i + 1).join('\n')
        expect(preceding).toContain('@experimental')
      }
    }
  })

  it('interop harness is in experimental section, not stable', () => {
    const classPath = path.join(repoRoot, 'CAPABILITY_CLASSIFICATION.md')
    const content = fs.readFileSync(classPath, 'utf-8')
    const stableIdx = content.indexOf('## Stable')
    const experimentalIdx = content.indexOf('## Experimental')

    const stableSection = content.slice(stableIdx, experimentalIdx)
    expect(stableSection).not.toContain('Interop')

    const experimentalSection = content.slice(experimentalIdx)
    expect(experimentalSection).toContain('Interop Harness')
  })
})
