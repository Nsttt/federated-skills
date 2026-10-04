import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import {
  pluginModuleFederation,
  RSBUILD_PLUGIN_MODULE_FEDERATION_NAME,
} from '@module-federation/rsbuild-plugin';
import type { RsbuildPlugin } from '@rsbuild/core';
import { rawSourceRule } from './build';
import { SKILLS_EXPOSE } from './constants';
import { inferMimeType } from './mime';

type ModuleFederationOptions = Parameters<typeof pluginModuleFederation>[0];

export interface PluginFederatedSkillsOptions {
  /** Module whose default export is `defineSkillsProvider(...)`. */
  provider: string;
  /**
   * Remote name. Gateways load the provider as `<name>@<manifest url>`.
   * Defaults to the `name` of a `pluginModuleFederation()` in the same config.
   */
  name?: string;
  /** Exposed module key. Defaults to `"./skills"`. */
  expose?: string;
  /** Rsbuild environment that builds the provider. Defaults to `"skills"`. */
  environment?: string;
  /**
   * Extra Module Federation options for the provider remote, e.g. `shared`,
   * more `exposes`, or `runtimePlugins`.
   */
  federation?: Partial<ModuleFederationOptions>;
}

const DEFAULT_ENVIRONMENT = 'skills';
// Rsbuild's default entry when `source.entry` is unset.
const DEFAULT_ENTRY_EXTENSIONS = [
  'ts',
  'js',
  'tsx',
  'jsx',
  'mts',
  'cts',
  'mjs',
  'cjs',
];

/** Whether Rsbuild's default entry exists and is something other than the provider. */
const hasOtherDefaultEntry = (root: string, provider: string) => {
  const entry = DEFAULT_ENTRY_EXTENSIONS.map((ext) =>
    path.join(root, `src/index.${ext}`),
  ).find((file) => existsSync(file));
  return entry !== undefined && entry !== path.resolve(root, provider);
};

interface ServerWithMiddlewares {
  middlewares: {
    use(
      fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void,
    ): unknown;
  };
}

/**
 * Serve a built environment from disk under `prefix`. Rsbuild's dev and
 * preview servers only serve web environments.
 */
const serveEnvironment = (
  server: ServerWithMiddlewares,
  getDistPath: () => string | undefined,
  prefix: string,
) => {
  server.middlewares.use(async (req, res, next) => {
    const distPath = getDistPath();
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (
      !distPath ||
      (req.method !== 'GET' && req.method !== 'HEAD') ||
      !pathname.startsWith(prefix)
    ) {
      return next();
    }
    const file = path.join(
      distPath,
      decodeURIComponent(pathname.slice(prefix.length)),
    );
    if (!file.startsWith(distPath + path.sep)) return next();
    try {
      const body = await readFile(file);
      res.setHeader('Content-Type', inferMimeType(file));
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      next();
    }
  });
};

/**
 * Build a skills provider with Rsbuild. Adds a Node environment that builds
 * the provider as a Module Federation remote with
 * `@module-federation/rsbuild-plugin`, which the gateway can load from any
 * static host.
 *
 * On its own, the provider is the whole build and lands in `dist/`. Next to
 * other builds (a web app, or a `pluginModuleFederation()` remote), those
 * keep building as before and the provider lands in `dist/<environment>/`.
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
  // Run after the app's own pluginModuleFederation() so its name is known.
  pre: [RSBUILD_PLUGIN_MODULE_FEDERATION_NAME],
  setup(api) {
    if (!options?.provider) {
      throw new Error(
        `pluginFederatedSkills needs { provider }, e.g. { name: 'billing', provider: './src/skills.ts' }`,
      );
    }
    const appFederation = api.useExposed<{
      getOptions(): ModuleFederationOptions;
    }>(RSBUILD_PLUGIN_MODULE_FEDERATION_NAME);
    const name = options.name ?? appFederation?.getOptions().name;
    if (!name) {
      throw new Error(
        `pluginFederatedSkills needs a remote name: pass { name } or add pluginModuleFederation({ name }) to the same config.`,
      );
    }
    const environment = options.environment ?? DEFAULT_ENVIRONMENT;
    let servePrefix = '/';

    api.modifyRsbuildConfig((config, { mergeRsbuildConfig }) => {
      const environments = { ...config.environments };
      const original = api.getRsbuildConfig('original');
      // With no environments, Rsbuild builds one named after its target.
      // Keep that build if it has anything to build besides the provider.
      const standalone =
        Object.keys(environments).length === 0 &&
        !appFederation &&
        original.source?.entry === undefined &&
        !hasOtherDefaultEntry(api.context.rootPath, options.provider);
      if (Object.keys(environments).length === 0 && !standalone) {
        environments[config.output?.target ?? 'web'] = {};
      }
      servePrefix = standalone ? '/' : `/${environment}/`;
      const distPath = config.output?.distPath;
      const distRoot =
        (typeof distPath === 'string' ? distPath : distPath?.root) ?? 'dist';
      environments[environment] = mergeRsbuildConfig(
        {
          // Rsbuild requires an entry; the remote container replaces it below.
          source: { entry: { [name]: options.provider } },
          output: {
            target: 'node',
            // Resolve chunks relative to wherever the manifest is served from.
            assetPrefix: 'auto',
            distPath: {
              root: standalone ? distRoot : path.join(distRoot, environment),
            },
          },
          // Written to disk so the dev server can serve it to gateways.
          dev: { assetPrefix: 'auto', writeToDisk: true },
        },
        environments[environment] ?? {},
      );
      return { ...config, environments };
    });

    const serve = ({
      server,
      environments,
    }: {
      server: ServerWithMiddlewares;
      environments: Record<string, { distPath: string }>;
    }) =>
      serveEnvironment(
        server,
        () => environments[environment]?.distPath,
        servePrefix,
      );
    api.onBeforeStartDevServer(serve);
    api.onBeforeStartPreviewServer(serve);

    api.modifyRspackConfig((config, { environment: env }) => {
      if (env.name !== environment) return;
      config.entry = {};
      (config.module ??= {}).rules = [
        ...(config.module.rules ?? []),
        rawSourceRule,
      ];
    });

    const { federation = {} } = options;
    const plugin = pluginModuleFederation(
      {
        filename: 'remoteEntry.js',
        manifest: true,
        ...federation,
        name,
        dts: false,
        exposes: {
          [options.expose ?? SKILLS_EXPOSE]: options.provider,
          ...(federation.exposes as Record<string, string> | undefined),
        },
      },
      { target: 'node', environment },
    );
    // Keep the app's own pluginModuleFederation() API exposed, not this one.
    plugin.setup({ ...api, expose: () => {} });
  },
});
