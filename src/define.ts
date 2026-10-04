import { parseSkillMarkdown, renderSkillMarkdown } from './frontmatter';
import { inferMimeType } from './mime';
import {
  SKILLS_PROVIDER_KIND,
  type AnySkillTool,
  type Skill,
  type SkillFile,
  type SkillFileInput,
  type SkillFrontmatter,
  type SkillTool,
  type SkillsProvider,
  type ToolSchema,
} from './types';
import {
  assertDescription,
  assertFilePath,
  assertNamespace,
  assertSkillName,
  assertToolName,
} from './validate';

interface SkillDefinitionBase {
  /**
   * Optional URI prefix, e.g. `"acme/payments"` publishes the skill at
   * `skill://acme/payments/<name>/SKILL.md`.
   */
  namespace?: string;
  /** Supporting files, keyed by path relative to the skill root. */
  files?: Record<string, SkillFileInput>;
}

/** Define a skill inline; the `SKILL.md` is generated for you. */
export interface InlineSkillDefinition extends SkillDefinitionBase {
  name: string;
  /** When an agent should use this skill. Agents read this to decide. */
  description: string;
  /** Markdown body of `SKILL.md` (everything after the frontmatter). */
  instructions: string;
  license?: string;
  compatibility?: string;
  allowedTools?: string | string[];
  metadata?: Record<string, string>;
}

/** Define a skill from an existing `SKILL.md`, served byte-for-byte. */
export interface MarkdownSkillDefinition extends SkillDefinitionBase {
  /** Full `SKILL.md` contents, frontmatter included. */
  markdown: string;
}

export type SkillDefinition = InlineSkillDefinition | MarkdownSkillDefinition;

const SKILL_FILE = 'SKILL.md';

export const normalizeSkillFile = (
  filePath: string,
  input: SkillFileInput,
): SkillFile => {
  if (typeof input === 'string') {
    return { mimeType: inferMimeType(filePath), text: input };
  }
  if (input instanceof Uint8Array) {
    return { mimeType: inferMimeType(filePath), data: input };
  }
  const mimeType = input.mimeType ?? inferMimeType(filePath);
  return 'text' in input
    ? { mimeType, text: input.text }
    : { mimeType, data: input.data };
};

const toFrontmatter = (
  definition: InlineSkillDefinition,
): Record<string, unknown> => ({
  name: definition.name,
  description: definition.description,
  license: definition.license,
  compatibility: definition.compatibility,
  'allowed-tools': Array.isArray(definition.allowedTools)
    ? definition.allowedTools.join(' ')
    : definition.allowedTools,
  metadata: definition.metadata,
});

/**
 * Define a skill.
 *
 * @example
 * ```ts
 * defineSkill({
 *   name: 'release-checklist',
 *   description: 'Use before publishing a new version of a package.',
 *   instructions: '# Release checklist\n\n1. Read references/gates.md ...',
 *   files: { 'references/gates.md': gatesMarkdown },
 * });
 *
 * // or reuse a SKILL.md you already have
 * import skillMd from './release-checklist/SKILL.md?raw';
 * defineSkill({ markdown: skillMd });
 * ```
 */
export function defineSkill(definition: SkillDefinition): Skill {
  let skillMarkdown: string;
  let frontmatter: Record<string, unknown>;

  if ('markdown' in definition) {
    skillMarkdown = definition.markdown;
    frontmatter = parseSkillMarkdown(skillMarkdown).frontmatter;
  } else {
    frontmatter = toFrontmatter(definition);
    skillMarkdown = renderSkillMarkdown(frontmatter, definition.instructions);
  }

  const name = assertSkillName(frontmatter['name']);
  assertDescription(name, frontmatter['description']);

  const files: Record<string, SkillFile> = {
    [SKILL_FILE]: { mimeType: 'text/markdown', text: skillMarkdown },
  };
  for (const [filePath, input] of Object.entries(definition.files ?? {})) {
    assertFilePath(name, filePath);
    if (filePath === SKILL_FILE) {
      throw new Error(
        `Skill "${name}" passes SKILL.md in "files"; use "instructions" or "markdown" instead`,
      );
    }
    files[filePath] = normalizeSkillFile(filePath, input);
  }

  const namespace = definition.namespace
    ? assertNamespace(definition.namespace)
    : '';

  return {
    path: namespace ? `${namespace}/${name}` : name,
    frontmatter: Object.fromEntries(
      Object.entries(frontmatter).filter(([, value]) => value !== undefined),
    ) as SkillFrontmatter,
    files,
  };
}

/**
 * Define a tool. The handler's input type is inferred from `inputSchema`,
 * which can be any Standard Schema with JSON Schema support (zod 4, valibot,
 * arktype, ...) or a plain JSON Schema object.
 *
 * @example
 * ```ts
 * defineTool({
 *   name: 'lookup_order',
 *   description: 'Fetch an order by id.',
 *   inputSchema: z.object({ id: z.string() }),
 *   annotations: { readOnlyHint: true },
 *   async handler({ id }) {
 *     return await orders.get(id); // objects become structured content
 *   },
 * });
 * ```
 */
export function defineTool<S extends ToolSchema | undefined = undefined>(
  tool: SkillTool<S>,
): SkillTool<S> {
  assertToolName(tool.name);
  if (typeof tool.handler !== 'function') {
    throw new Error(`Tool "${tool.name}" is missing a handler function`);
  }
  return tool;
}

export interface SkillsProviderDefinition {
  /** Provider id. Defaults to the Module Federation remote name. */
  name?: string;
  /** Provider build version, surfaced to tools and in server metadata. */
  version?: string;
  skills?: Skill[];
  tools?: AnySkillTool[];
}

/**
 * Bundle skills and tools into a provider. Export the result from the module
 * your remote exposes (by default `./skills`).
 *
 * @example
 * ```ts
 * export default defineSkillsProvider({
 *   version: '1.4.0',
 *   skills: [releaseChecklist],
 *   tools: [lookupOrder],
 * });
 * ```
 */
export function defineSkillsProvider(
  definition: SkillsProviderDefinition,
): SkillsProvider {
  return {
    kind: SKILLS_PROVIDER_KIND,
    name: definition.name,
    version: definition.version,
    skills: definition.skills ?? [],
    tools: definition.tools ?? [],
  };
}

export const isSkillsProvider = (value: unknown): value is SkillsProvider =>
  typeof value === 'object' &&
  value !== null &&
  (value as SkillsProvider).kind === SKILLS_PROVIDER_KIND &&
  Array.isArray((value as SkillsProvider).skills) &&
  Array.isArray((value as SkillsProvider).tools);
