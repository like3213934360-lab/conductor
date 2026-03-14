import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
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

  it('only exposes task kernel commands in the command contract', () => {
    const ids = WORKFLOW_COMMANDS.map(command => command.id)
    expect(ids).toContain('antigravity.runTask')
    expect(ids).toContain('antigravity.getTask')
    expect(ids).toContain('antigravity.streamTask')
    expect(ids).toContain('antigravity.cancelTask')
    expect(ids).not.toContain('antigravity.getRunSession')
    expect(ids).not.toContain('antigravity.approveGate')
  })

  it('keeps the extension manifest aligned with the task kernel command surface', () => {
    const readme = readText('README.md')

    expect(readme).toContain('docs/ANTIGRAVITY_CONTRACT.md')
  })

  it('keeps Quick Start task-kernel aware', () => {
    const quickStart = readText('docs/QUICK_START.md')
    expect(quickStart).toContain('Antigravity')
  })
})
