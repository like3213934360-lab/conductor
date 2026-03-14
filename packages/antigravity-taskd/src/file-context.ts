import * as fs from 'node:fs'
import * as path from 'node:path'

const IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.turbo',
  '.next',
  'out',
  'build',
])

const MAX_FILE_BYTES = 200 * 1024
const MAX_TOTAL_BYTES = 1024 * 1024

export interface WorkspaceFileEntry {
  path: string
  size: number
}

export function listWorkspaceFiles(workspaceRoot: string, maxFiles = 400): WorkspaceFileEntry[] {
  const results: WorkspaceFileEntry[] = []

  function visit(currentDir: string): void {
    if (results.length >= maxFiles) return
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      if (results.length >= maxFiles) return
      if (entry.name.startsWith('.') && entry.name !== '.env' && entry.name !== '.github') continue
      if (IGNORE_DIRS.has(entry.name)) continue

      const absPath = path.join(currentDir, entry.name)
      const relPath = path.relative(workspaceRoot, absPath)
      if (entry.isDirectory()) {
        visit(absPath)
        continue
      }
      if (!entry.isFile()) continue

      try {
        const stat = fs.statSync(absPath)
        if (stat.size > MAX_FILE_BYTES) continue
        results.push({ path: relPath, size: stat.size })
      } catch {
        // Ignore transient file errors.
      }
    }
  }

  visit(workspaceRoot)
  return results
}

export function buildFileContext(workspaceRoot: string, filePaths: string[]): { context: string; loadedPaths: string[] } {
  const sections: string[] = []
  const loadedPaths: string[] = []
  let totalBytes = 0

  for (const relativePath of filePaths) {
    const absolutePath = path.isAbsolute(relativePath)
      ? relativePath
      : path.join(workspaceRoot, relativePath)
    if (!fs.existsSync(absolutePath)) continue
    const stat = fs.statSync(absolutePath)
    if (!stat.isFile()) continue
    if (stat.size > MAX_FILE_BYTES) continue

    totalBytes += stat.size
    if (totalBytes > MAX_TOTAL_BYTES) break

    const content = fs.readFileSync(absolutePath, 'utf8')
    const label = path.relative(workspaceRoot, absolutePath)
    sections.push(`=== FILE: ${label} ===\n${content.trimEnd()}\n=== END FILE ===`)
    loadedPaths.push(label)
  }

  return {
    context: sections.length > 0
      ? `The following workspace files are provided as authoritative context:\n\n${sections.join('\n\n')}`
      : '',
    loadedPaths,
  }
}

export function pickSharedFiles(candidates: string[]): string[] {
  const preferred = candidates.filter(candidate => {
    const base = path.basename(candidate)
    return [
      'package.json',
      'tsconfig.json',
      'tsconfig.base.json',
      'README.md',
      'turbo.json',
      'pnpm-workspace.yaml',
      'package-lock.json',
    ].includes(base)
  })
  return preferred.slice(0, 5)
}

export function chunkShardFiles(files: WorkspaceFileEntry[], maxFilesPerShard = 8, maxShardBytes = 250 * 1024): string[][] {
  const shards: string[][] = []
  let current: string[] = []
  let currentBytes = 0

  for (const file of files) {
    if (current.length >= maxFilesPerShard || currentBytes + file.size > maxShardBytes) {
      if (current.length > 0) {
        shards.push(current)
      }
      current = []
      currentBytes = 0
    }
    current.push(file.path)
    currentBytes += file.size
  }

  if (current.length > 0) {
    shards.push(current)
  }

  return shards
}

export function totalBytes(files: WorkspaceFileEntry[]): number {
  return files.reduce((sum, file) => sum + file.size, 0)
}
