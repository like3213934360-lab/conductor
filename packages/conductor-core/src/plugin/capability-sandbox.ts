/**
 * Conductor AGC — Plugin 能力沙箱
 *
 * Phase 4: Capability-based Security Model
 *
 * 插件声明的 capabilities 在运行时强制校验。
 * 未声明的能力会被拒绝，防止恶意/错误插件越权。
 *
 * 设计参考:
 * - Deno permissions: --allow-read, --allow-net
 * - WASI capability-based security
 * - Android manifest permissions
 *
 * 安全设计:
 * 1. 白名单模式: 只有声明的能力才被允许
 * 2. 路径沙箱: 文件访问限制在声明的路径内
 * 3. 网络沙箱: 默认禁止网络访问
 * 4. 环境变量沙箱: 只能读取声明的变量
 */
import type { PluginPermissions } from './plugin-types.js'
import * as path from 'node:path'
import * as fs from 'node:fs'

/** 能力类型 */
export type CapabilityType = 'fs:read' | 'fs:write' | 'network' | 'env'

/** 能力校验错误 */
export class CapabilityDeniedError extends Error {
  constructor(
    public readonly pluginId: string,
    public readonly capability: CapabilityType,
    public readonly detail?: string,
  ) {
    super(`[CapabilityDenied] 插件 [${pluginId}] 未声明能力: ${capability}${detail ? ` (${detail})` : ''}`)
    this.name = 'CapabilityDeniedError'
  }
}

/**
 * CapabilitySandbox — 插件能力沙箱
 *
 * 每个插件实例创建一个沙箱，基于其 manifest.permissions 校验访问。
 */
export class CapabilitySandbox {
  private readonly pluginId: string
  private readonly permissions: PluginPermissions
  /** 插件独立数据目录 (始终允许读写) */
  private readonly dataDir: string

  constructor(pluginId: string, dataDir: string, permissions?: PluginPermissions) {
    this.pluginId = pluginId
    // 三模型审计: 使用 realpath 防止 symlink 绕过, 末尾加分隔符防前缀攻击
    this.dataDir = ensureTrailingSep(resolveRealPath(dataDir))
    this.permissions = permissions ?? {}
  }

  /**
   * 检查文件系统读取权限
   *
   * 规则:
   * 1. 插件数据目录 (dataDir) 始终允许
   * 2. manifest.permissions.fs 中声明的路径允许
   * 3. 其它路径拒绝
   */
  assertFsRead(targetPath: string): void {
    // 三模型审计: realpath 防 symlink + 末尾分隔符防前缀攻击
    const resolved = resolveRealPath(targetPath)

    // 数据目录始终允许
    if (resolved.startsWith(this.dataDir)) return

    // 检查声明的路径
    if (this.permissions.fs) {
      for (const allowedPath of this.permissions.fs) {
        const resolvedAllowed = ensureTrailingSep(resolveRealPath(allowedPath))
        if (resolved.startsWith(resolvedAllowed)) return
      }
    }

    throw new CapabilityDeniedError(this.pluginId, 'fs:read', resolved)
  }

  /**
   * 检查文件系统写入权限
   *
   * 规则: 只允许写入插件数据目录
   */
  assertFsWrite(targetPath: string): void {
    // 三模型审计: realpath 防 symlink
    const resolved = resolveRealPath(targetPath)

    if (resolved.startsWith(this.dataDir)) return

    throw new CapabilityDeniedError(this.pluginId, 'fs:write', resolved)
  }

  /**
   * 检查网络访问权限
   */
  assertNetwork(): void {
    if (this.permissions.network) return
    throw new CapabilityDeniedError(this.pluginId, 'network')
  }

  /**
   * 检查环境变量读取权限
   *
   * 规则: 只允许读取 manifest.permissions.env 中声明的变量
   */
  assertEnv(varName: string): void {
    if (this.permissions.env && this.permissions.env.includes(varName)) return
    throw new CapabilityDeniedError(this.pluginId, 'env', varName)
  }

  /**
   * 获取受沙箱保护的环境变量读取器
   *
   * 返回一个函数，只能读取声明的环境变量。
   */
  createEnvReader(): (varName: string) => string | undefined {
    return (varName: string): string | undefined => {
      this.assertEnv(varName)
      return process.env[varName]
    }
  }

  /** 获取插件 ID */
  getPluginId(): string {
    return this.pluginId
  }

  /** 获取已声明的权限 (只读) */
  getPermissions(): Readonly<PluginPermissions> {
    return this.permissions
  }
}

// ─── 安全工具函数 ──────────────────────────────

/** 三模型审计: 解析真实路径 (防 symlink 绕过) */
function resolveRealPath(p: string): string {
  const resolved = path.resolve(p)
  try {
    return fs.realpathSync(resolved)
  } catch {
    // 路径不存在时降级到 resolve (新文件写入场景)
    return resolved
  }
}

/** 三模型审计: 确保路径以分隔符结尾 (防前缀攻击: /data/plugin-evil vs /data/plugin) */
function ensureTrailingSep(p: string): string {
  return p.endsWith(path.sep) ? p : p + path.sep
}
