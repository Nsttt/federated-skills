import { createRequire } from 'node:module';
import path from 'node:path';
import type { moduleFederationPlugin } from '@module-federation/sdk';
import { SKILLS_EXPOSE } from './constants';

type ModuleFederationPluginOptions =
  moduleFederationPlugin.ModuleFederationPluginOptions;

export interface SkillsProviderPluginOptions {
  /** Remote name. Gateways load the provider as `<name>@<manifest url>`. */
  name: string;
  /** Module whose default export is `defineSkillsProvider(...)`. */
  provider: string;
  /** Exposed module key. Defaults to `"./skills"`. */
  expose?: string;
  /**
   * Extra Module Federation options merged into the generated config, e.g.
   * `shared`, additional `exposes`, or `runtimePlugins`.
   */
  federation?: Partial<ModuleFederationPluginOptions>;
}

interface CompilerLike {
  context: string;
  options: {
    target?: unknown;
    module: { rules: unknown[] };
  };
  rspack?: unknown;
  webpack?: { WebpackError: new (message: string) => Error };
  hooks: {
    thisCompilation: {
      tap(name: string, fn: (compilation: { warnings: Error[] }) => void): void;
    };
  };
}

const PLUGIN_NAME = 'SkillsProviderPlugin';

/** Turns `import text from './SKILL.md?raw'` into a string import. */
export const rawSourceRule = {
  resourceQuery: /(?:^|[?&])raw(?:$|&)/,
  type: 'asset/source',
} as const;

/**
 * The Module Federation options a skills provider needs: a Node-loadable
 * remote with a manifest, exposing the provider module.
 */
export function skillsProviderFederationOptions(
  options: SkillsProviderPluginOptions,
  resolveFrom: string = process.cwd(),
): ModuleFederationPluginOptions {
  const requireFromProject = createRequire(path.join(resolveFrom, 'noop.js'));
  const { federation = {} } = options;
  return {
    filename: 'remoteEntry.js',
    manifest: true,
    dts: false,
    library: { type: 'commonjs-module', name: options.name },
    ...federation,
    name: options.name,
    exposes: {
      [options.expose ?? SKILLS_EXPOSE]: options.provider,
      ...(federation.exposes as Record<string, string> | undefined),
    },
    runtimePlugins: [
      requireFromProject.resolve('@module-federation/node/runtimePlugin'),
      ...(federation.runtimePlugins ?? []),
    ],
  };
}

/**
 * Build a skills provider remote with rspack or webpack. Requires
 * `@module-federation/enhanced` and `@module-federation/node`.
 *
 * @example
 * ```js
 * // rspack.config.js
 * const { SkillsProviderPlugin } = require('@module-federation/federated-skills/build');
 *
 * module.exports = {
 *   target: 'async-node',
 *   entry: {},
 *   plugins: [
 *     new SkillsProviderPlugin({ name: 'billing', provider: './src/skills.ts' }),
 *   ],
 * };
 * ```
 */
export class SkillsProviderPlugin {
  readonly options: SkillsProviderPluginOptions;

  constructor(options: SkillsProviderPluginOptions) {
    if (!options?.name || !options.provider) {
      throw new Error(
        `${PLUGIN_NAME} needs { name, provider }, e.g. { name: 'billing', provider: './src/skills.ts' }`,
      );
    }
    this.options = options;
  }

  apply(compiler: CompilerLike): void {
    const requireFromProject = createRequire(
      path.join(compiler.context, 'noop.js'),
    );
    const enhanced = requireFromProject(
      compiler.rspack
        ? '@module-federation/enhanced/rspack'
        : '@module-federation/enhanced/webpack',
    ) as {
      ModuleFederationPlugin: new (options: ModuleFederationPluginOptions) => {
        apply(compiler: unknown): void;
      };
    };

    compiler.options.module.rules.push(rawSourceRule);
    new enhanced.ModuleFederationPlugin(
      skillsProviderFederationOptions(this.options, compiler.context),
    ).apply(compiler);

    const target = [compiler.options.target].flat().join(',');
    if (!target.includes('node')) {
      compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation) => {
        const message = `${PLUGIN_NAME}: skills providers are loaded by a Node.js gateway; set \`target: 'async-node'\` (current: ${target || 'default'}).`;
        compilation.warnings.push(
          compiler.webpack
            ? new compiler.webpack.WebpackError(message)
            : new Error(message),
        );
      });
    }
  }
}
