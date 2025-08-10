import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'index.ts',
    'stubs/main.ts',
    'commands/*',
    'providers/*',
    'services/*',
  ],
  clean: true,
  treeshake: true,
  outDir: './build',
  format: ['esm'],
  dts: true,
  target: 'esnext',
})
