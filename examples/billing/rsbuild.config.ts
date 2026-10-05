import { defineConfig } from '@rsbuild/core';
import { pluginModuleFederation } from '@module-federation/rsbuild-plugin';
import { pluginFederatedSkills } from '@module-federation/mcp/rsbuild';

// An app that is already a web remote. Browsers keep loading `billing` from
// /mf-manifest.json; the skills provider builds next to it, in /skills/.
export default defineConfig({
  server: { port: 3002 },
  plugins: [
    pluginModuleFederation({
      name: 'billing',
      exposes: { './checkout': './src/checkout.ts' },
      dts: false,
    }),
    // Takes the remote name `billing` from pluginModuleFederation above.
    pluginFederatedSkills({ provider: './src/skills.ts' }),
  ],
});
