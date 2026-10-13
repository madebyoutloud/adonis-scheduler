import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // swc emits decorator metadata, required by @inject() in the IoC container
  plugins: [swc.vite()],
  test: {
    include: ['test/**/*.spec.ts'],
    setupFiles: ['reflect-metadata'],
    coverage: {
      include: ['src/**', 'providers/**', 'commands/**', 'services/**'],
    },
  },
})
