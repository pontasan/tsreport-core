import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: true,
    setupFiles: ['src/node.ts'],
    globalSetup: [
      'tests/download-test-fonts.ts',
      'tests/hb-compat/download-fonts.ts',
      'tests/layout/download-ucd-bidi.ts',
      'tests/layout/download-ucd-line-break.ts',
      'tests/layout/download-ucd-grapheme-break.ts',
    ],
  },
});
