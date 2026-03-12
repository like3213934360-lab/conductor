import * as path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@anthropic/antigravity-shared': path.resolve(__dirname, 'packages/antigravity-shared/src/index.ts'),
      '@anthropic/antigravity-core': path.resolve(__dirname, 'packages/antigravity-core/src/index.ts'),
      '@anthropic/antigravity-persistence': path.resolve(__dirname, 'packages/antigravity-persistence/src/index.ts'),
      '@anthropic/antigravity-daemon': path.resolve(__dirname, 'packages/antigravity-daemon/src/index.ts'),
      '@anthropic/antigravity-model-shared': path.resolve(__dirname, 'packages/antigravity-model-shared/src/index.ts'),
      '@anthropic/antigravity-model-core': path.resolve(__dirname, 'packages/antigravity-model-core/src/index.ts'),
      '@anthropic/antigravity-mcp-server': path.resolve(__dirname, 'packages/antigravity-mcp-server/src/index.ts'),
    },
  },
  test: {
    include: [
      'packages/**/*.spec.ts',
      'packages/**/*.test.ts',
    ],
    exclude: [
      '**/dist/**',
      '**/*.d.ts',
      'node_modules/**',
    ],
  },
})
