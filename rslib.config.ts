import { readFileSync } from 'node:fs';
import { defineConfig } from '@rslib/core';

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as {
  version: string;
};

// Pure ESM, bundleless: every source file becomes one output file next to
// its declarations. Entry points load only the modules they use, and
// bundlers can drop whatever a consumer doesn't import.
export default defineConfig({
  lib: [{ format: 'esm', syntax: 'es2022', bundle: false, dts: true }],
  source: {
    entry: { index: './src/**' },
    tsconfigPath: './tsconfig.lib.json',
    define: {
      __VERSION__: JSON.stringify(version),
    },
  },
  output: {
    target: 'node',
    sourceMap: true,
  },
});
