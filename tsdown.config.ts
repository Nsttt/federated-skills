import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsdown';

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as {
  version: string;
};

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    server: 'src/server/index.ts',
    build: 'src/build.ts',
    rsbuild: 'src/rsbuild.ts',
    protocol: 'src/protocol.ts',
    cli: 'src/cli.ts',
  },
  tsconfig: 'tsconfig.lib.json',
  format: ['cjs', 'esm'],
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: { resolver: 'tsc' },
  fixedExtension: false,
  outExtensions: ({ format }) =>
    format === 'cjs'
      ? { js: '.cjs', dts: '.d.ts' }
      : { js: '.js', dts: '.d.ts' },
  external: [
    /^@module-federation\//,
    /^@modelcontextprotocol\//,
    'yaml',
    /^zod/,
  ],
  define: {
    __VERSION__: JSON.stringify(version),
  },
  copy: ['LICENSE'],
});
