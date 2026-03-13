/**
 * PR-16: MCP Server standalone smoke test.
 *
 * Verifies that the MCP server modules can be imported and the
 * server factory function exists. Does NOT start a daemon connection.
 */

process.stderr.write('[smoke] importing MCP server module…\n')

const serverMod = await import('./dist/server.js')

if (typeof serverMod.createAntigravityMcpServer !== 'function') {
  process.stderr.write('[smoke] FAIL: createAntigravityMcpServer is not a function\n')
  process.exit(1)
}

process.stderr.write('[smoke] createAntigravityMcpServer found ✓\n')

process.stderr.write('[smoke] importing context module…\n')

const contextMod = await import('./dist/context.js')

if (typeof contextMod.createServerContext !== 'function') {
  process.stderr.write('[smoke] FAIL: createServerContext is not a function\n')
  process.exit(1)
}

process.stderr.write('[smoke] createServerContext found ✓\n')

process.stderr.write('[smoke] importing tool-registry module…\n')

const toolMod = await import('./dist/tool-registry.js')

if (!toolMod) {
  process.stderr.write('[smoke] FAIL: tool-registry module not loadable\n')
  process.exit(1)
}

process.stderr.write('[smoke] tool-registry loaded ✓\n')

process.stderr.write('[smoke] MCP standalone smoke PASSED ✓\n')
