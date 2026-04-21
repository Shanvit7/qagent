import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli/index.ts'],
  format: ['esm'],
  dts: true,
  outDir: 'dist',
  clean: true,
  target: 'node18',
  platform: 'node',
  // Do NOT bundle node_modules — let Node handle CJS/ESM interop natively
  esbuildOptions(options) {
    options.packages = 'external'
  },
})
