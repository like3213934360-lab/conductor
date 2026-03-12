import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runObjectiveOracles } from '../src/objective-oracles.js'

describe('objective oracles', () => {
  let tempDir: string | undefined

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
      tempDir = undefined
    }
  })

  it('parses structured-data json files deterministically', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-structured-data-'))
    const filePath = path.join(tempDir, 'sample.json')
    fs.writeFileSync(filePath, JSON.stringify({ ok: true }), 'utf8')

    const results = await runObjectiveOracles({
      taskClass: 'structured-data',
      verifiabilityClass: 'high',
      filePaths: [filePath],
    })

    expect(results[0]?.passed).toBe(true)
    expect(results[0]?.tool).toContain('json-parse')
  })

  it('fails closed when no deterministic oracle exists for a high-verifiability task', async () => {
    const results = await runObjectiveOracles({
      taskClass: 'governance',
      verifiabilityClass: 'high',
      workspaceRoot: '/tmp/project',
      filePaths: [],
    })

    expect(results[0]?.passed).toBe(false)
    expect(results[0]?.exitCode).toBe(127)
  })
})
