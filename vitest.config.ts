import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Host integration tests live in `tests/`; the SDK's own behaviour tests
    // live beside the package so they can run without any host installed.
    include: ['tests/**/*.spec.ts', 'packages/*/tests/**/*.spec.ts'],
  },
})
