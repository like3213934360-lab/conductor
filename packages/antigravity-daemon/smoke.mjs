/**
 * PR-16: Daemon standalone smoke test.
 *
 * Verifies that the daemon entry module can be imported and the host
 * can be launched with temporary directories, creates a Unix socket,
 * then shuts down cleanly.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daemon-smoke-'))
const dataDir = path.join(tmpDir, 'data')
const socketPath = path.join(tmpDir, 'daemon.sock')
const projectionPath = path.join(tmpDir, 'projection.json')

fs.mkdirSync(dataDir, { recursive: true })

process.stderr.write('[smoke] importing daemon host…\n')

const { launchAntigravityDaemonHost } = await import('./dist/host.js')

process.stderr.write('[smoke] launching daemon…\n')

const host = await launchAntigravityDaemonHost({
  workspaceRoot: tmpDir,
  dataDir,
  projectionPath,
  socketPath,
  callbackHost: '127.0.0.1',
  callbackPort: 0,
})

// Verify socket was created
if (!fs.existsSync(socketPath)) {
  process.stderr.write('[smoke] FAIL: socket not created\n')
  await host.close()
  fs.rmSync(tmpDir, { recursive: true, force: true })
  process.exit(1)
}

process.stderr.write('[smoke] daemon started, socket exists ✓\n')
process.stderr.write('[smoke] shutting down…\n')

await host.close()

fs.rmSync(tmpDir, { recursive: true, force: true })

process.stderr.write('[smoke] daemon standalone smoke PASSED ✓\n')
