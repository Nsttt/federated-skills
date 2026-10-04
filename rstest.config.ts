import { defineConfig } from '@rstest/core';
import path from 'node:path';

export default defineConfig({
  source: {
    define: {
      __VERSION__: '"test"',
    },
  },
  testEnvironment: 'node',
  include: [path.resolve(import.meta.dirname, '__tests__/*.spec.ts')],
  testTimeout: 20000,
});
