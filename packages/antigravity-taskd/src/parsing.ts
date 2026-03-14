export function parseStructuredJson<T>(raw: string): T | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  try {
    return JSON.parse(trimmed) as T
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start === -1 || end <= start) return null
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as T
    } catch {
      return null
    }
  }
}

export function normalizeText(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim()
    : ''
}
