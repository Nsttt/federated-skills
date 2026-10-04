import {
  SkillsProviderPlugin,
  type SkillsProviderPluginOptions,
} from './build';

export type PluginFederatedSkillsOptions = SkillsProviderPluginOptions;

// Structural subset of Rsbuild's plugin API, so `@rsbuild/core` stays optional.
interface RsbuildPluginAPI {
  getRsbuildConfig(type: 'original'): { source?: { entry?: unknown } };
  modifyRsbuildConfig(
    fn: (
      config: Record<string, unknown>,
      utils: {
        mergeRsbuildConfig: (
          ...configs: Record<string, unknown>[]
        ) => Record<string, unknown>;
      },
    ) => Record<string, unknown>,
  ): void;
  modifyRspackConfig(
    fn: (config: {
      target?: unknown;
      entry?: unknown;
      plugins?: unknown[];
    }) => void,
  ): void;
}

export interface RsbuildPlugin {
  name: string;
  setup(api: RsbuildPluginAPI): void;
}

/**
 * Build a skills provider with Rsbuild. Produces a CommonJS remote with a
 * manifest that the gateway's Node runtime can load from any static host.
 * Requires `@module-federation/enhanced` and `@module-federation/node`.
 *
 * @example
 * ```ts
 * // rsbuild.config.ts
 * import { defineConfig } from '@rsbuild/core';
 * import { pluginFederatedSkills } from '@module-federation/federated-skills/rsbuild';
 *
 * export default defineConfig({
 *   plugins: [pluginFederatedSkills({ name: 'billing', provider: './src/skills.ts' })],
 * });
 * ```
 */
export const pluginFederatedSkills = (
  options: PluginFederatedSkillsOptions,
): RsbuildPlugin => ({
  name: 'federated-skills:provider',
  setup(api) {
    // Rsbuild requires an entry, but a provider only needs its exposed module.
    const ownsEntry =
      api.getRsbuildConfig('original').source?.entry === undefined;

    api.modifyRsbuildConfig((config, { mergeRsbuildConfig }) =>
      mergeRsbuildConfig(config, {
        ...(ownsEntry
          ? { source: { entry: { [options.name]: options.provider } } }
          : {}),
        output: {
          target: 'node',
          // The gateway evaluates remotes as CommonJS.
          module: false,
          assetPrefix: 'auto',
        },
      }),
    );

    api.modifyRspackConfig((config) => {
      config.target = 'async-node';
      if (ownsEntry) config.entry = {};
      (config.plugins ??= []).push(new SkillsProviderPlugin(options));
    });
  },
});
