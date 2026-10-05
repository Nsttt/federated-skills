import { defineConfig } from '@rspack/cli';
import { SkillsProviderPlugin } from '@module-federation/mcp/build';

// The support tools team builds with plain Rspack. SkillsProviderPlugin turns
// the build into a skills provider remote the gateway can load.
export default defineConfig({
  target: 'async-node',
  entry: {},
  output: { publicPath: 'auto', clean: true },
  resolve: { extensions: ['.ts', '.js'] },
  module: {
    rules: [
      {
        test: /\.ts$/,
        loader: 'builtin:swc-loader',
        options: { jsc: { parser: { syntax: 'typescript' } } },
        type: 'javascript/auto',
      },
    ],
  },
  plugins: [
    new SkillsProviderPlugin({ name: 'support', provider: './src/skills.ts' }),
  ],
  devServer: { port: 3003, hot: false, liveReload: false },
});
