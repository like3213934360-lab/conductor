import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    root: path.resolve(__dirname),
    include: ['src/**/__tests__/**/*.spec.ts'],
    globals: true,
    environment: 'node',
  },
})
