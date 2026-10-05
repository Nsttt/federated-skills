import { defineConfig } from '@rsbuild/core';
import { pluginFederatedSkills } from '@module-federation/mcp/rsbuild';

// A project that only ships skills: the provider is the whole build.
export default defineConfig({
  server: { port: 3001 },
  plugins: [
    pluginFederatedSkills({ name: 'releases', provider: './src/skills.ts' }),
  ],
});
