import { describe, expect, it } from 'vitest'
import { createAntigravityDaemonProcessEnv } from '../process-host.js'

describe('Antigravity daemon process host helpers', () => {
  it('builds the canonical daemon process environment from workspace paths', () => {
    const { paths, env } = createAntigravityDaemonProcessEnv({
      workspaceRoot: '/tmp/antigravity-workspace',
      callbackHost: '127.0.0.1',
      callbackPort: 45123,
      callbackBaseUrl: 'https://callback.example.test',
      env: {
        EXTRA_FLAG: '1',
      },
    })

    expect(paths.dataDir).toBe('/tmp/antigravity-workspace/data/antigravity_daemon')
    expect(paths.projectionPath).toBe('/tmp/antigravity-workspace/data/antigravity_daemon/run-projection.json')
    expect(env.ANTIGRAVITY_DAEMON_WORKSPACE_ROOT).toBe('/tmp/antigravity-workspace')
    expect(env.ANTIGRAVITY_DAEMON_DATA_DIR).toBe(paths.dataDir)
    expect(env.ANTIGRAVITY_DAEMON_PROJECTION_PATH).toBe(paths.projectionPath)
    expect(env.ANTIGRAVITY_DAEMON_SOCKET_PATH).toBe(paths.socketPath)
    expect(env.ANTIGRAVITY_DAEMON_CALLBACK_HOST).toBe('127.0.0.1')
    expect(env.ANTIGRAVITY_DAEMON_CALLBACK_PORT).toBe('45123')
    expect(env.ANTIGRAVITY_DAEMON_CALLBACK_BASE_URL).toBe('https://callback.example.test')
    expect(env.EXTRA_FLAG).toBe('1')
  })

  it('includes strictTrustMode env var when specified', () => {
    const { env } = createAntigravityDaemonProcessEnv({
      workspaceRoot: '/tmp/antigravity-workspace',
      strictTrustMode: true,
    })
    expect(env.ANTIGRAVITY_DAEMON_STRICT_TRUST_MODE).toBe('true')
  })

  it('omits strictTrustMode env var when not specified', () => {
    const { env } = createAntigravityDaemonProcessEnv({
      workspaceRoot: '/tmp/antigravity-workspace',
    })
    expect(env.ANTIGRAVITY_DAEMON_STRICT_TRUST_MODE).toBeUndefined()
  })
})
