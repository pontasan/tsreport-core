import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/browser.ts', 'src/node.ts'],
  format: ['esm', 'cjs'],
  dts: false,
  minify: true,
  sourcemap: false,
  clean: true,
  target: 'es2020',
});
