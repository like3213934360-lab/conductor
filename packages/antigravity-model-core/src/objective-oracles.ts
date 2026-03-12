import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawn } from 'node:child_process'

export interface ObjectiveOracleResult {
  tool: string
  passed: boolean
  output: string
  exitCode: number
}

export interface ObjectiveOracleContext {
  taskClass: 'analysis' | 'code' | 'text' | 'structured-data' | 'governance'
  verifiabilityClass: 'low' | 'medium' | 'high'
  workspaceRoot?: string
  filePaths?: string[]
}

interface SpawnedCommand {
  command: string
  args: string[]
  cwd: string
}

async function runCommand(command: SpawnedCommand, timeoutMs = 60_000): Promise<ObjectiveOracleResult> {
  return new Promise((resolve) => {
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let settled = false

    const timer = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      child.kill('SIGTERM')
      resolve({
        tool: path.basename(command.command),
        passed: false,
        output: `Timed out after ${timeoutMs}ms`,
        exitCode: 124,
      })
    }, timeoutMs)

    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)))
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)))
    child.on('error', error => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      resolve({
        tool: path.basename(command.command),
        passed: false,
        output: error.message,
        exitCode: 127,
      })
    })
    child.on('close', code => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      const output = `${Buffer.concat(stdout).toString('utf8')}\n${Buffer.concat(stderr).toString('utf8')}`.trim()
      resolve({
        tool: path.basename(command.command),
        passed: code === 0,
        output,
        exitCode: code ?? 1,
      })
    })
  })
}

function localBin(workspaceRoot: string, name: string): string | undefined {
  const candidate = path.join(workspaceRoot, 'node_modules', '.bin', name)
  return fs.existsSync(candidate) ? candidate : undefined
}

function loadPackageJson(workspaceRoot: string): { scripts?: Record<string, string> } | undefined {
  const pkgPath = path.join(workspaceRoot, 'package.json')
  if (!fs.existsSync(pkgPath)) {
    return undefined
  }
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> }
  } catch {
    return undefined
  }
}

function unavailable(tool: string, reason: string): ObjectiveOracleResult {
  return {
    tool,
    passed: false,
    output: reason,
    exitCode: 127,
  }
}

async function runCodeOracles(workspaceRoot: string): Promise<ObjectiveOracleResult[]> {
  const pkg = loadPackageJson(workspaceRoot)
  const results: ObjectiveOracleResult[] = []

  const tsc = localBin(workspaceRoot, 'tsc')
  if (tsc) {
    results.push(await runCommand({ command: tsc, args: ['--noEmit', '--pretty', 'false'], cwd: workspaceRoot }))
  } else if (pkg?.scripts?.typecheck) {
    results.push(await runCommand({ command: 'npm', args: ['run', 'typecheck'], cwd: workspaceRoot }))
  } else {
    results.push(unavailable('tsc', 'No local TypeScript compiler or typecheck script available'))
  }

  const eslint = localBin(workspaceRoot, 'eslint')
  if (eslint) {
    results.push(await runCommand({ command: eslint, args: ['.', '--max-warnings=0'], cwd: workspaceRoot }))
  } else if (pkg?.scripts?.lint) {
    results.push(await runCommand({ command: 'npm', args: ['run', 'lint'], cwd: workspaceRoot }))
  } else {
    results.push(unavailable('eslint', 'No local ESLint binary or lint script available'))
  }

  const vitest = localBin(workspaceRoot, 'vitest')
  if (vitest) {
    results.push(await runCommand({ command: vitest, args: ['run', '--passWithNoTests'], cwd: workspaceRoot }))
  } else if (pkg?.scripts?.test) {
    results.push(await runCommand({ command: 'npm', args: ['run', 'test'], cwd: workspaceRoot }))
  } else {
    results.push(unavailable('vitest', 'No local Vitest binary or test script available'))
  }

  return results
}

async function runStructuredDataOracles(filePaths: string[]): Promise<ObjectiveOracleResult[]> {
  if (filePaths.length === 0) {
    return [unavailable('structured-data', 'No structured-data files were provided')]
  }

  return filePaths.map(filePath => {
    try {
      const ext = path.extname(filePath).toLowerCase()
      const raw = fs.readFileSync(filePath, 'utf8')
      if (ext === '.json') {
        JSON.parse(raw)
        return {
          tool: `json-parse:${path.basename(filePath)}`,
          passed: true,
          output: 'JSON parse succeeded',
          exitCode: 0,
        }
      }
      return unavailable(`structured-data:${path.basename(filePath)}`, `Unsupported structured-data extension: ${ext}`)
    } catch (error) {
      return {
        tool: `structured-data:${path.basename(filePath)}`,
        passed: false,
        output: error instanceof Error ? error.message : String(error),
        exitCode: 1,
      }
    }
  })
}

export async function runObjectiveOracles(context: ObjectiveOracleContext): Promise<ObjectiveOracleResult[]> {
  if (context.verifiabilityClass !== 'high') {
    return []
  }

  if (context.taskClass === 'code') {
    if (!context.workspaceRoot) {
      return [unavailable('code-oracles', 'Missing workspace root for code objective oracles')]
    }
    return runCodeOracles(context.workspaceRoot)
  }

  if (context.taskClass === 'structured-data') {
    return runStructuredDataOracles(context.filePaths ?? [])
  }

  return [unavailable('objective-oracle', `No deterministic oracle is configured for taskClass=${context.taskClass}`)]
}
