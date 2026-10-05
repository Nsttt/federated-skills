import { createSkillsCatalog, type SkillsCatalog } from './catalog';
import {
  loadSkillsProviders,
  type LoadProvidersOptions,
  type SkillsProviderSource,
} from './load';

export interface SkillsCacheHint {
  /** Cache lifetime in milliseconds. Defaults to 5 minutes. */
  ttlMs?: number;
  /** `public` lets shared caches store results. Defaults to `public`. */
  cacheScope?: 'public' | 'private';
}

/** How a server presents a catalog. Shared by every adapter. */
export interface SkillsServeOptions {
  /** MCP server name reported to clients. */
  name?: string;
  /** MCP server version reported to clients. */
  version?: string;
  /**
   * Instructions sent to clients on connect. Defaults to a short index of the
   * available skills, which lets agents discover them even when their client
   * does not implement `skills/list` yet. Pass `false` to omit.
   */
  instructions?: string | false | ((catalog: SkillsCatalog) => string);
  /** Cache hint for `skills/list`, `skills/get` and skill files. Defaults to 5 minutes, public. */
  cache?: SkillsCacheHint;
}

export interface SkillsGatewayOptions
  extends LoadProvidersOptions, SkillsServeOptions {
  /** Where skills and tools come from. See {@link SkillsProviderSource}. */
  providers: readonly SkillsProviderSource[];
}

export const DEFAULT_SERVER_NAME = 'module-federation-skills';

/**
 * Instructions that index the catalog's skills, for clients that do not
 * implement `skills/list` yet. Empty when there are no skills.
 */
export const defaultInstructions = (catalog: SkillsCatalog): string => {
  if (catalog.skills.length === 0) return '';
  const index = catalog.skills
    .map(
      (skill) =>
        `- ${skill.frontmatter.name}: ${skill.frontmatter.description} (${skill.uri})`,
    )
    .join('\n');
  return `This server provides agent skills. When a task matches a skill, read its SKILL.md resource first and follow it; supporting files are listed alongside it.\n\n${index}`;
};

export const resolveInstructions = (
  catalog: SkillsCatalog,
  instructions: SkillsServeOptions['instructions'],
): string | undefined => {
  if (instructions === false) return undefined;
  if (typeof instructions === 'string') return instructions;
  return (instructions ?? defaultInstructions)(catalog) || undefined;
};

export const resolveCacheHint = (cache: SkillsCacheHint = {}) => ({
  ttlMs: cache.ttlMs ?? 300_000,
  cacheScope: cache.cacheScope ?? ('public' as const),
});

/** Load every provider and merge them into one catalog. */
export async function loadSkillsCatalog(
  sources: readonly SkillsProviderSource[],
  options: LoadProvidersOptions = {},
): Promise<SkillsCatalog> {
  return createSkillsCatalog(await loadSkillsProviders(sources, options));
}
