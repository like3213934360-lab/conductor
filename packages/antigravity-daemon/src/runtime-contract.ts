import * as crypto from 'node:crypto'
import * as os from 'node:os'
import * as path from 'node:path'

export const ANTIGRAVITY_AUTHORITY_OWNER = 'antigravity-daemon' as const
export const ANTIGRAVITY_AUTHORITY_HOST = 'antigravity' as const

export const ANTIGRAVITY_CALLBACK_INGRESS_SEGMENT = 'remote-worker-callbacks' as const
export const ANTIGRAVITY_CALLBACK_INGRESS_PATH = '/remote-worker-callbacks/:callbackToken' as const
export const ANTIGRAVITY_CALLBACK_AUTH_SCHEME = 'hmac-sha256' as const
export const ANTIGRAVITY_CALLBACK_SIGNATURE_HEADER = 'x-antigravity-callback-signature' as const
export const ANTIGRAVITY_CALLBACK_TIMESTAMP_HEADER = 'x-antigravity-callback-timestamp' as const

export const ANTIGRAVITY_DAEMON_DATA_DIRNAME = 'antigravity_daemon' as const
export const ANTIGRAVITY_DAEMON_DB_NAME = 'antigravity-daemon.db' as const
export const ANTIGRAVITY_DAEMON_PROJECTION_FILE = 'run-projection.json' as const
export const ANTIGRAVITY_DAEMON_POLICY_PACK_FILE = 'policy-pack.json' as const
export const ANTIGRAVITY_DAEMON_TRUST_REGISTRY_FILE = 'trust-registry.json' as const
export const ANTIGRAVITY_DAEMON_REMOTE_WORKERS_FILE = 'remote-workers.json' as const
export const ANTIGRAVITY_DAEMON_BENCHMARK_SOURCE_REGISTRY_FILE = 'benchmark-source-registry.json' as const
export const ANTIGRAVITY_DAEMON_BENCHMARK_MANIFEST_FILE = 'benchmark-manifest.json' as const
export const ANTIGRAVITY_DAEMON_BENCHMARK_DATASET_FILE = 'benchmark-dataset.json' as const
export const ANTIGRAVITY_DAEMON_INTEROP_MANIFEST_FILE = 'interop-manifest.json' as const
export const ANTIGRAVITY_DAEMON_ATTESTATIONS_DIR = 'attestations' as const
export const ANTIGRAVITY_DAEMON_RELEASE_DOSSIERS_DIR = 'release-dossiers' as const
export const ANTIGRAVITY_DAEMON_RELEASE_BUNDLES_DIR = 'release-bundles' as const
export const ANTIGRAVITY_DAEMON_CERTIFICATION_RECORDS_DIR = 'certification-records' as const
export const ANTIGRAVITY_DAEMON_INVARIANT_REPORTS_DIR = 'invariant-reports' as const
export const ANTIGRAVITY_DAEMON_POLICY_REPORTS_DIR = 'policy-reports' as const
export const ANTIGRAVITY_DAEMON_TRANSPARENCY_LEDGER_FILE = 'transparency-ledger.jsonl' as const

export const ANTIGRAVITY_DAEMON_CALLBACK_HOST_DEFAULT = '127.0.0.1' as const
export const ANTIGRAVITY_DAEMON_CALLBACK_PORT_DEFAULT = 0 as const
export const ANTIGRAVITY_TRUST_KEY_PREFIX = 'ANTIGRAVITY_TRUST_KEY_' as const
export const ANTIGRAVITY_DAEMON_ENTRY_ENV = 'ANTIGRAVITY_DAEMON_ENTRY' as const

export const ANTIGRAVITY_DAEMON_ENV = {
  workspaceRoot: 'ANTIGRAVITY_DAEMON_WORKSPACE_ROOT',
  dataDir: 'ANTIGRAVITY_DAEMON_DATA_DIR',
  projectionPath: 'ANTIGRAVITY_DAEMON_PROJECTION_PATH',
  socketPath: 'ANTIGRAVITY_DAEMON_SOCKET_PATH',
  callbackHost: 'ANTIGRAVITY_DAEMON_CALLBACK_HOST',
  callbackPort: 'ANTIGRAVITY_DAEMON_CALLBACK_PORT',
  callbackBaseUrl: 'ANTIGRAVITY_DAEMON_CALLBACK_BASE_URL',
} as const

export function resolveAntigravityDaemonDataDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, 'data', ANTIGRAVITY_DAEMON_DATA_DIRNAME)
}

export function resolveAntigravityDaemonProjectionPath(workspaceRoot: string): string {
  return path.join(resolveAntigravityDaemonDataDir(workspaceRoot), ANTIGRAVITY_DAEMON_PROJECTION_FILE)
}

export function resolveAntigravityDaemonSocketPath(workspaceRoot: string): string {
  const workspaceHash = crypto.createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 12)
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\${ANTIGRAVITY_AUTHORITY_OWNER}-${workspaceHash}`
    : path.join(os.tmpdir(), `${ANTIGRAVITY_AUTHORITY_OWNER}-${workspaceHash}.sock`)
}
