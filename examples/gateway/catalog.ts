import path from 'node:path';
import {
  loadSkillsCatalog,
  skillsDirectory,
  type SkillsCatalog,
} from '@module-federation/mcp/catalog';
import { platform, registry, type Environment } from './registry.ts';

export const environment: Environment =
  process.env.SKILLS_ENV === 'prod' ? 'prod' : 'dev';

/**
 * Load every registered provider plus the platform's own skills.
 *
 * By default a provider that fails to load is skipped, so one team's outage
 * doesn't take the gateway down. `strict` fails instead, for CI.
 */
export const loadCatalog = ({ strict = false } = {}): Promise<SkillsCatalog> =>
  loadSkillsCatalog(
    [
      ...registry.map((provider) => ({
        name: provider.name,
        entry: provider.entry[environment],
        optional: !strict,
      })),
      skillsDirectory(path.join(import.meta.dirname, 'skills'), {
        name: platform.name,
        namespace: 'acme/platform',
      }),
    ],
    { logger: { warn: (message: string) => console.error(message) } },
  );

/** Registered providers that didn't load. */
export const unavailable = (catalog: SkillsCatalog) =>
  registry.filter(
    (provider) =>
      !catalog.providers.some((loaded) => loaded.name === provider.name),
  );
