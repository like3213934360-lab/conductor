import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DAEMON_API_CONTRACT } from '../../../antigravity-daemon/src/manifest.js'
import { WORKFLOW_COMMANDS } from '../workflow-contract.js'

const repoRoot = path.resolve(__dirname, '../../../../')

function readText(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

describe('Antigravity contract drift checks', () => {
  it('keeps workflow command ids unique', () => {
    const ids = WORKFLOW_COMMANDS.map(command => command.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every(id => id.startsWith('antigravity.'))).toBe(true)
  })

  it('keeps the extension package manifest aligned with the workflow command contract', () => {
    const pkg = JSON.parse(readText('package.json')) as {
      contributes?: {
        commands?: Array<{ command: string; title: string }>
      }
    }
    const contributed = new Map(
      (pkg.contributes?.commands ?? []).map(command => [command.command, command.title]),
    )

    for (const command of WORKFLOW_COMMANDS) {
      expect(contributed.get(command.id)).toBe(command.title)
    }
    expect([...contributed.keys()].sort()).toEqual(WORKFLOW_COMMANDS.map(command => command.id).sort())
  })

  it('includes unified release artifact commands in the command contract', () => {
    const ids = WORKFLOW_COMMANDS.map(command => command.id)
    expect(ids).toContain('antigravity.getRunSession')
    expect(ids).toContain('antigravity.getReleaseArtifacts')
    expect(ids).toContain('antigravity.getPolicyReport')
    expect(ids).toContain('antigravity.verifyReleaseArtifacts')
    expect(ids).toContain('antigravity.verifyPolicyReport')
    expect(ids).toContain('antigravity.getInvariantReport')
    expect(ids).toContain('antigravity.verifyInvariantReport')
    expect(ids).toContain('antigravity.getReleaseBundle')
    expect(ids).toContain('antigravity.verifyReleaseBundle')
    expect(ids).toContain('antigravity.getReleaseDossier')
    expect(ids).toContain('antigravity.verifyReleaseDossier')
  })

  it('keeps the Antigravity contract documentation aligned with commands and daemon routes', () => {
    const contractDoc = readText('docs/ANTIGRAVITY_CONTRACT.md')
    const readme = readText('README.md')

    for (const command of WORKFLOW_COMMANDS) {
      expect(contractDoc).toContain(`\`${command.id}\``)
    }

    for (const route of DAEMON_API_CONTRACT.routes) {
      expect(contractDoc).toContain(`\`${route.path}\``)
      expect(contractDoc).toContain(`\`${route.operationId}\``)
    }

    expect(readme).toContain('docs/ANTIGRAVITY_CONTRACT.md')
  })

  it('keeps Quick Start daemon-first', () => {
    const quickStart = readText('docs/QUICK_START.md')
    expect(quickStart).toContain('launchAntigravityDaemonHost')
    expect(quickStart).toContain("workflowId: 'antigravity.strict-full'")
  })
})
