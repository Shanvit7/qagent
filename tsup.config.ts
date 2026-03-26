import { defineConfig } from "tsup";

export default defineConfig({
  entry: { "cli/index": "src/cli/index.ts" },
  format: ["esm"],
  target: "node18",
  platform: "node",
  outDir: "dist",
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: false,
  shims: true,     // polyfill __dirname / __filename for ESM
  treeshake: true,
});
