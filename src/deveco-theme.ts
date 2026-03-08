import { workspace, ConfigurationTarget } from 'vscode'

// DevEco Studio (IntelliJ Darcula) TextMate 主题色规则
const DEVECO_TEXTMATE_RULES = [
  { scope: 'keyword.control.ets', settings: { foreground: '#CC7832' } },
  { scope: 'keyword.operator.ets', settings: { foreground: '#CC7832' } },
  { scope: 'keyword.control.import.ets', settings: { foreground: '#CC7832' } },
  { scope: 'storage.type.ets', settings: { foreground: '#CC7832' } },
  { scope: 'storage.type.struct.ets', settings: { foreground: '#CC7832' } },
  { scope: 'string.quoted.single.ets', settings: { foreground: '#6A8759' } },
  { scope: 'string.quoted.double.ets', settings: { foreground: '#6A8759' } },
  { scope: 'string.template.ets', settings: { foreground: '#6A8759' } },
  { scope: 'comment.line.double-slash.ets', settings: { foreground: '#808080' } },
  { scope: 'comment.block.ets', settings: { foreground: '#808080' } },
  { scope: 'comment.block.documentation.ets', settings: { foreground: '#629755' } },
  { scope: 'keyword.other.documentation.ets', settings: { foreground: '#629755', fontStyle: 'bold' } },
  { scope: 'constant.numeric.ets', settings: { foreground: '#6897BB' } },
  { scope: 'constant.language.ets', settings: { foreground: '#CC7832' } },
  { scope: 'constant.character.escape.ets', settings: { foreground: '#CC7832' } },
  { scope: 'entity.name.function.ets', settings: { foreground: '#FFC66D' } },
  { scope: 'entity.name.function.method.ets', settings: { foreground: '#FFC66D' } },
  { scope: 'entity.name.function.component.ets', settings: { foreground: '#FFC66D' } },
  { scope: 'entity.name.type.class.ets', settings: { foreground: '#A9B7C6' } },
  { scope: 'variable.other.property.ets', settings: { foreground: '#9876AA' } },
  { scope: 'variable.language.this.ets', settings: { foreground: '#CC7832' } },
  { scope: 'meta.decorator.ets', settings: { foreground: '#BBB529' } },
  { scope: 'punctuation.decorator.ets', settings: { foreground: '#BBB529' } },
  { scope: 'entity.name.tag.decorator.ets', settings: { foreground: '#BBB529' } },
  { scope: 'support.type.primitive.ets', settings: { foreground: '#CC7832' } },
  { scope: 'support.type.arkts.ets', settings: { foreground: '#A9B7C6' } },
  { scope: 'punctuation.definition.template-expression.begin.ets', settings: { foreground: '#CC7832' } },
  { scope: 'punctuation.definition.template-expression.end.ets', settings: { foreground: '#CC7832' } },
]

const TEXTMATE_SENTINEL_SCOPE = 'keyword.control.ets'

// 语义高亮规则
const DEVECO_SEMANTIC_RULES: Record<string, string | { foreground: string; fontStyle: string }> = {
  'namespace:arkts': '#A9B7C6',
  'type:arkts': '#A9B7C6',
  'class:arkts': '#A9B7C6',
  'enum:arkts': '#A9B7C6',
  'interface:arkts': '#A9B7C6',
  'struct:arkts': '#A9B7C6',
  'typeParameter:arkts': '#A9B7C6',
  'parameter:arkts': '#A9B7C6',
  'variable:arkts': '#A9B7C6',
  'property:arkts': '#9876AA',
  'enumMember:arkts': '#9876AA',
  'function:arkts': '#FFC66D',
  'method:arkts': '#FFC66D',
  'keyword:arkts': '#CC7832',
  'string:arkts': '#6A8759',
  'number:arkts': '#6897BB',
  'comment:arkts': '#808080',
  'operator:arkts': '#A9B7C6',
  'decorator:arkts': '#BBB529',
  'variable.readonly:arkts': '#A9B7C6',
  'property.static:arkts': { foreground: '#9876AA', fontStyle: 'italic' },
  'method.static:arkts': { foreground: '#FFC66D', fontStyle: 'italic' },
}

/** 应用 DevEco Studio 配色方案 */
export function applyDevEcoColors(): void {
  const config = workspace.getConfiguration('editor')
  applyTextMateColors(config)
  applySemanticColors(config)
}

function applyTextMateColors(config: ReturnType<typeof workspace.getConfiguration>): void {
  const inspection = config.inspect<Record<string, unknown>>('tokenColorCustomizations')
  const userGlobal = inspection?.globalValue as Record<string, unknown> | undefined
  const existingRules = (userGlobal?.textMateRules || []) as Array<{ scope: string; settings: Record<string, string> }>

  const hasSentinel = existingRules.some(
    (r) => r.scope === TEXTMATE_SENTINEL_SCOPE && r.settings?.foreground === '#CC7832',
  )
  if (hasSentinel) return

  const filteredRules = existingRules.filter(
    (r) => typeof r.scope !== 'string' || !r.scope.endsWith('.ets'),
  )
  const mergedRules = [...filteredRules, ...DEVECO_TEXTMATE_RULES]

  config.update(
    'tokenColorCustomizations',
    { ...(userGlobal || {}), textMateRules: mergedRules },
    ConfigurationTarget.Global,
  ).then(undefined, () => { })
}

function applySemanticColors(config: ReturnType<typeof workspace.getConfiguration>): void {
  const inspection = config.inspect<Record<string, unknown>>('semanticTokenColorCustomizations')
  const userGlobal = inspection?.globalValue as Record<string, unknown> | undefined
  const currentRules = (userGlobal?.rules || {}) as Record<string, unknown>

  const hasEnabled = userGlobal?.enabled === true
  const allPresent = hasEnabled && Object.keys(DEVECO_SEMANTIC_RULES).every((key) => key in currentRules)
  if (allPresent) return

  const mergedRules = { ...currentRules, ...DEVECO_SEMANTIC_RULES }

  config.update(
    'semanticTokenColorCustomizations',
    { ...(userGlobal || {}), enabled: true, rules: mergedRules },
    ConfigurationTarget.Global,
  ).then(
    () => { config.update('semanticHighlighting.enabled', true, ConfigurationTarget.Global) },
    () => { },
  )
}
