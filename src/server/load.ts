import {
  createInstance,
  type ModuleFederation,
} from '@module-federation/runtime';
import { SKILLS_EXPOSE } from '../constants';
import { isSkillsProvider } from '../define';
import type { SkillsProvider } from '../types';
import type { ResolvedSkillsProvider } from './catalog';

/** A skills provider published as a Module Federation remote. */
export interface RemoteSkillsProvider {
  /** Remote name, as set by `name` in the provider's federation config. */
  name: string;
  /** URL of the remote's `mf-manifest.json` or `remoteEntry.js`. */
  entry: string;
  /** Exposed module to load. Defaults to `"./skills"`. */
  expose?: string;
  /** Log and skip this provider when it fails to load instead of throwing. */
  optional?: boolean;
}

/**
 * Where skills come from. Mix and match:
 * - `"name@https://cdn.example.com/mf-manifest.json"`
 * - `{ name, entry, expose?, optional? }`
 * - a provider object from `defineSkillsProvider()` (in-process)
 * - a function returning a provider, e.g. `skillsDirectory('./skills')`
 */
export type SkillsProviderSource =
  | string
  | RemoteSkillsProvider
  | SkillsProvider
  | (() => SkillsProvider | Promise<SkillsProvider>);

export type FederationRuntimeOptions = Partial<
  Parameters<typeof createInstance>[0]
>;

export interface LoadProvidersOptions {
  /**
   * A Module Federation runtime instance to load remotes with, or options for
   * the one created for you (e.g. runtime `plugins` for auth or retries).
   */
  federation?: ModuleFederation | FederationRuntimeOptions;
  /** Where warnings about optional providers go. Defaults to `console`. */
  logger?: Pick<Console, 'warn'>;
}

const DEFAULT_RUNTIME_NAME = 'mf_skills_mcp_gateway';

export const parseRemoteSource = (value: string): RemoteSkillsProvider => {
  const at = value.indexOf('@', 1);
  const name = at > 0 ? value.slice(0, at).trim() : '';
  const entry = at > 0 ? value.slice(at + 1).trim() : '';
  if (!name || !entry) {
    throw new Error(
      `Invalid remote "${value}": expected "<name>@<url>", e.g. "billing@https://cdn.example.com/billing/mf-manifest.json"`,
    );
  }
  return { name, entry };
};

const isFederationInstance = (
  value: LoadProvidersOptions['federation'],
): value is ModuleFederation =>
  typeof (value as ModuleFederation | undefined)?.loadRemote === 'function';

const pickProvider = (module: unknown): SkillsProvider | undefined => {
  if (isSkillsProvider(module)) return module;
  const exports = module as Record<string, unknown> | null | undefined;
  for (const key of ['default', 'provider', 'skills']) {
    const candidate = exports?.[key];
    if (isSkillsProvider(candidate)) return candidate;
  }
  return undefined;
};

const resolve = (
  provider: SkillsProvider,
  fallbackName: string,
  source: string,
): ResolvedSkillsProvider => ({
  ...provider,
  name: provider.name ?? fallbackName,
  source,
});

const describe = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Load every provider source, in order. */
export async function loadSkillsProviders(
  sources: readonly SkillsProviderSource[],
  options: LoadProvidersOptions = {},
): Promise<ResolvedSkillsProvider[]> {
  const logger = options.logger ?? console;
  let federation: ModuleFederation | undefined;

  const getFederation = (): ModuleFederation => {
    if (federation) return federation;
    const configured = options.federation;
    federation = isFederationInstance(configured)
      ? configured
      : createInstance({
          name: DEFAULT_RUNTIME_NAME,
          remotes: [],
          ...configured,
        });
    return federation;
  };

  const loadRemote = async (
    remote: RemoteSkillsProvider,
  ): Promise<ResolvedSkillsProvider | undefined> => {
    const expose = (remote.expose ?? SKILLS_EXPOSE).replace(/^\.\//, '');
    const id = `${remote.name}/${expose}`;
    try {
      const mf = getFederation();
      mf.registerRemotes([{ name: remote.name, entry: remote.entry }], {
        force: true,
      });
      const module = await mf.loadRemote<unknown>(id);
      const provider = pickProvider(module);
      if (!provider) {
        throw new Error(
          `"${id}" does not export a skills provider. Export the result of defineSkillsProvider() as the default export.`,
        );
      }
      return resolve(provider, remote.name, remote.entry);
    } catch (error) {
      const message = `Failed to load skills provider "${remote.name}" from ${remote.entry}: ${describe(error)}`;
      if (remote.optional) {
        logger.warn(`[federated-skills] ${message} (skipped)`);
        return undefined;
      }
      throw new Error(message, { cause: error });
    }
  };

  const loaded = await Promise.all(
    sources.map(async (source, index) => {
      if (typeof source === 'string') {
        return loadRemote(parseRemoteSource(source));
      }
      if (typeof source === 'function') {
        const provider = await source();
        if (!isSkillsProvider(provider)) {
          throw new Error(
            `Provider source #${index} did not return a skills provider; use defineSkillsProvider()`,
          );
        }
        return resolve(provider, `local-${index}`, 'local');
      }
      if (isSkillsProvider(source)) {
        return resolve(source, `local-${index}`, 'local');
      }
      if (source && typeof source === 'object' && 'entry' in source) {
        return loadRemote(source);
      }
      throw new Error(
        `Unsupported provider source #${index}; expected "name@url", { name, entry }, or a provider from defineSkillsProvider()`,
      );
    }),
  );

  return loaded.filter((provider) => provider !== undefined);
}
