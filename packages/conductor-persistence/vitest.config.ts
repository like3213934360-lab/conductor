import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    root: __dirname,
    include: ['src/**/__tests__/**/*.spec.ts'],
    globals: true,
    environment: 'node',
  },
})
