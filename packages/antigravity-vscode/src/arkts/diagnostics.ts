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

export class DiagnosticsAccumulator implements Disposable {
  private readonly collection: DiagnosticCollection
  private readonly accumulator = new Map<string, Map<string, any[]>>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private readonly logFn: LogFn) {
    this.collection = languages.createDiagnosticCollection('arkts')
  }

  accumulate(uri: string, diagnostics: any[]): void {
    const waveKey = `wave-${Date.now()}-${Math.random()}`
    if (!this.accumulator.has(uri)) {
      this.accumulator.set(uri, new Map())
    }
    const uriMap = this.accumulator.get(uri)!
    if (diagnostics.length > 0) {
      uriMap.set(waveKey, diagnostics)
    }

    if (this.timers.has(uri)) {
      clearTimeout(this.timers.get(uri)!)
    }
    this.timers.set(uri, setTimeout(() => {
      this.pushMerged(uri)
      this.timers.delete(uri)
    }, 500))
  }

  clear(uri: string): void {
    this.accumulator.delete(uri)
    if (this.timers.has(uri)) {
      clearTimeout(this.timers.get(uri)!)
      this.timers.delete(uri)
    }
  }

  handleAceDiagnostic(data: any): void {
    if (data?.result?.uri && data?.result?.diagnostics?.length > 0) {
      const vsDiags = data.result.diagnostics.map((diagnostic: any) => {
        const range = new Range(
          diagnostic.range?.start?.line ?? 0, diagnostic.range?.start?.character ?? 0,
          diagnostic.range?.end?.line ?? 0, diagnostic.range?.end?.character ?? 0,
        )
        const severity = diagnostic.severity === 1 ? DiagnosticSeverity.Error
          : diagnostic.severity === 2 ? DiagnosticSeverity.Warning
            : diagnostic.severity === 3 ? DiagnosticSeverity.Information
              : DiagnosticSeverity.Hint
        const value = new VSDiagnostic(range, diagnostic.message || '', severity)
        if (diagnostic.source) value.source = diagnostic.source
        if (diagnostic.code !== undefined) value.code = diagnostic.code
        return value
      })
      this.accumulate(data.result.uri, vsDiags)
    }
  }

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
    for (const diagnostics of uriMap.values()) {
      merged.push(...diagnostics)
    }

    const seen = new Set<string>()
    const unique = merged.filter(diagnostic => {
      const startLine = diagnostic.range?.start?.line ?? 0
      const startChar = diagnostic.range?.start?.character ?? 0
      const key = `${startLine}:${startChar}:${diagnostic.message}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    this.collection.set(Uri.parse(uri), unique)
    this.logFn(`诊断推送: ${uri.split('/').pop()} → ${unique.length} 条`)
  }
}
