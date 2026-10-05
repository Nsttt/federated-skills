import { readFileSync } from 'node:fs';
import { defineConfig } from '@rslib/core';

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as {
  version: string;
};

export default defineConfig({
  lib: [
    { format: 'esm', syntax: 'es2022', dts: true },
    { format: 'cjs', syntax: 'es2022' },
  ],
  source: {
    entry: {
      index: './src/index.ts',
      server: './src/server/index.ts',
      mcp: './src/mcp.ts',
      effect: './src/effect/index.ts',
      build: './src/build.ts',
      rsbuild: './src/rsbuild.ts',
      protocol: './src/protocol.ts',
      cli: './src/cli.ts',
    },
    tsconfigPath: './tsconfig.lib.json',
    define: {
      __VERSION__: JSON.stringify(version),
    },
  },
  output: {
    target: 'node',
    sourceMap: true,
    copy: ['./LICENSE', './README.md'],
  },
});
