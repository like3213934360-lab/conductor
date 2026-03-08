import {
  languages,
  Uri,
  Range,
  Diagnostic as VSDiagnostic,
  DiagnosticSeverity,
  DiagnosticCollection,
  Disposable,
} from 'vscode'

export type LogFn = (msg: string) => void

/**
 * 诊断累积器
 * ace-server 分多个验证波次发送 publishDiagnostics（Resource/Ets/Ts），
 * 每波会替换该 URI 的全部诊断。后续空波会覆盖前面的有效诊断。
 * 解决方案：拦截 publishDiagnostics，累积所有波次的诊断，
 * 用防抖延迟合并后推送给 VS Code。
 */
export class DiagnosticsAccumulator implements Disposable {
  private readonly collection: DiagnosticCollection
  private readonly accumulator = new Map<string, Map<string, any[]>>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly logFn: LogFn

  constructor(logFn: LogFn) {
    this.collection = languages.createDiagnosticCollection('arkts')
    this.logFn = logFn
  }

  /** 累积一个波次的诊断 */
  accumulate(uri: string, diagnostics: any[]): void {
    const waveKey = `wave-${Date.now()}-${Math.random()}`

    if (!this.accumulator.has(uri)) {
      this.accumulator.set(uri, new Map())
    }
    const uriMap = this.accumulator.get(uri)!

    if (diagnostics.length > 0) {
      uriMap.set(waveKey, diagnostics)
    }
    // 空波次不累积，但仍触发防抖合并（允许 ace-server 清除所有诊断）

    // 防抖合并
    if (this.timers.has(uri)) {
      clearTimeout(this.timers.get(uri)!)
    }
    this.timers.set(uri, setTimeout(() => {
      this.pushMerged(uri)
      this.timers.delete(uri)
    }, 500))
  }

  /** 清除指定 URI 的旧诊断波次（文件变更时调用） */
  clear(uri: string): void {
    this.accumulator.delete(uri)
    // 同时取消未触发的合并 timer
    if (this.timers.has(uri)) {
      clearTimeout(this.timers.get(uri)!)
      this.timers.delete(uri)
    }
  }

  /** 处理 ace 自定义诊断通知（raw LSP → VS Code Diagnostic） */
  handleAceDiagnostic(data: any): void {
    if (data?.result?.uri && data?.result?.diagnostics?.length > 0) {
      const vsDiags = data.result.diagnostics.map((d: any) => {
        const range = new Range(
          d.range?.start?.line ?? 0, d.range?.start?.character ?? 0,
          d.range?.end?.line ?? 0, d.range?.end?.character ?? 0,
        )
        const severity = d.severity === 1 ? DiagnosticSeverity.Error
          : d.severity === 2 ? DiagnosticSeverity.Warning
            : d.severity === 3 ? DiagnosticSeverity.Information
              : DiagnosticSeverity.Hint
        const diag = new VSDiagnostic(range, d.message || '', severity)
        if (d.source) diag.source = d.source
        if (d.code !== undefined) diag.code = d.code
        return diag
      })
      this.accumulate(data.result.uri, vsDiags)
    }
  }

  get diagnosticCollection(): DiagnosticCollection {
    return this.collection
  }

  /** 释放资源：清理所有 timer + dispose collection */
  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
    this.accumulator.clear()
    this.collection.dispose()
  }

  private pushMerged(uri: string): void {
    const uriMap = this.accumulator.get(uri)
    if (!uriMap) return

    const merged: any[] = []
    for (const diags of uriMap.values()) {
      merged.push(...diags)
    }

    // 去重（基于行号+消息）
    const seen = new Set<string>()
    const unique = merged.filter(d => {
      const startLine = d.range?.start?.line ?? 0
      const startChar = d.range?.start?.character ?? 0
      const key = `${startLine}:${startChar}:${d.message}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    this.collection.set(Uri.parse(uri), unique)
    this.logFn(`诊断推送: ${uri.split('/').pop()} → ${unique.length} 条`)
  }
}
