import { launchAntigravityDaemonHost } from './host.js'
import {
  ANTIGRAVITY_DAEMON_CALLBACK_HOST_DEFAULT,
  ANTIGRAVITY_DAEMON_CALLBACK_PORT_DEFAULT,
  ANTIGRAVITY_DAEMON_ENV,
} from './runtime-contract.js'

function getRequiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

async function main(): Promise<void> {
  const callbackHost = process.env[ANTIGRAVITY_DAEMON_ENV.callbackHost] ?? ANTIGRAVITY_DAEMON_CALLBACK_HOST_DEFAULT
  const callbackPort = Number(process.env[ANTIGRAVITY_DAEMON_ENV.callbackPort] ?? String(ANTIGRAVITY_DAEMON_CALLBACK_PORT_DEFAULT))
  // P1-A fix: read strictTrustMode + federationFailPolicy from env — completes subprocess config bridge
  const strictTrustModeRaw = process.env[ANTIGRAVITY_DAEMON_ENV.strictTrustMode]
  const federationFailPolicyRaw = process.env[ANTIGRAVITY_DAEMON_ENV.federationFailPolicy]
  const host = await launchAntigravityDaemonHost({
    workspaceRoot: getRequiredEnv(ANTIGRAVITY_DAEMON_ENV.workspaceRoot),
    dataDir: getRequiredEnv(ANTIGRAVITY_DAEMON_ENV.dataDir),
    projectionPath: getRequiredEnv(ANTIGRAVITY_DAEMON_ENV.projectionPath),
    socketPath: getRequiredEnv(ANTIGRAVITY_DAEMON_ENV.socketPath),
    callbackHost,
    callbackPort: Number.isFinite(callbackPort) ? callbackPort : 0,
    callbackBaseUrl: process.env[ANTIGRAVITY_DAEMON_ENV.callbackBaseUrl],
    // P1-A fix: pass security config from env to daemon host
    strictTrustMode: strictTrustModeRaw === 'true',
    federationFailPolicy: federationFailPolicyRaw === 'fail-closed' ? 'fail-closed' : 'fallback',
  })

  const shutdown = () => {
    void host.close().finally(() => process.exit(0))
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exit(1)
})
