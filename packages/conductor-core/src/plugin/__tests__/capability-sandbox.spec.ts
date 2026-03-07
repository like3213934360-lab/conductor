/**
 * capability-sandbox.spec.ts — 能力沙箱安全测试
 */
import { describe, it, expect } from 'vitest'
import { CapabilitySandbox, CapabilityDeniedError } from '../capability-sandbox.js'
import type { PluginPermissions } from '../plugin-types.js'

describe('CapabilitySandbox', () => {
  const basePermissions: PluginPermissions = {
    fs: ['/tmp/test-data'],
    env: ['NODE_ENV', 'HOME'],
    network: false,
  }

  it('应允许授权路径的文件读取', () => {
    const sandbox = new CapabilitySandbox('test-plugin', '/tmp/plugin-data', basePermissions)
    expect(() => sandbox.assertFsRead('/tmp/test-data/file.txt')).not.toThrow()
  })

  it('应拒绝未授权路径的文件读取', () => {
    const sandbox = new CapabilitySandbox('test-plugin', '/tmp/plugin-data', basePermissions)
    expect(() => sandbox.assertFsRead('/etc/passwd')).toThrow(CapabilityDeniedError)
  })

  it('应允许数据目录的文件写入', () => {
    const sandbox = new CapabilitySandbox('test-plugin', '/tmp/plugin-data', basePermissions)
    expect(() => sandbox.assertFsWrite('/tmp/plugin-data/result.json')).not.toThrow()
  })

  it('应拒绝非数据目录的文件写入', () => {
    const sandbox = new CapabilitySandbox('test-plugin', '/tmp/plugin-data', basePermissions)
    expect(() => sandbox.assertFsWrite('/tmp/evil/output.json')).toThrow(CapabilityDeniedError)
  })

  it('应允许授权的环境变量访问', () => {
    const sandbox = new CapabilitySandbox('test-plugin', '/tmp/plugin-data', basePermissions)
    expect(() => sandbox.assertEnv('NODE_ENV')).not.toThrow()
  })

  it('应拒绝未授权的环境变量访问', () => {
    const sandbox = new CapabilitySandbox('test-plugin', '/tmp/plugin-data', basePermissions)
    expect(() => sandbox.assertEnv('AWS_SECRET_KEY')).toThrow(CapabilityDeniedError)
  })

  it('应拒绝未授权的网络访问', () => {
    const sandbox = new CapabilitySandbox('test-plugin', '/tmp/plugin-data', basePermissions)
    expect(() => sandbox.assertNetwork()).toThrow(CapabilityDeniedError)
  })

  it('启用网络后应允许网络访问', () => {
    const caps: PluginPermissions = { ...basePermissions, network: true }
    const sandbox = new CapabilitySandbox('test-plugin', '/tmp/plugin-data', caps)
    expect(() => sandbox.assertNetwork()).not.toThrow()
  })
})
