/** Agent Skills name: lowercase letters, digits and single hyphens. */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Tool names, the same everywhere: repo, catalog, API and MCP. */
export const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const MAX_SKILL_NAME_LENGTH = 64;
export const MAX_DESCRIPTION_LENGTH = 1024;
export const MAX_COMPATIBILITY_LENGTH = 500;

/** Names the Zephyr MCP keeps for its own tools; never valid for a catalog tool. */
export const RESERVED_TOOL_NAMES: readonly string[] = [
  'search',
  'execute',
  'connection_status',
];

/** A skill name that is also valid as a skill folder name. */
export const isSkillName = (name: unknown): boolean =>
  typeof name === 'string' &&
  name.length <= MAX_SKILL_NAME_LENGTH &&
  SKILL_NAME_PATTERN.test(name) &&
  name !== 'evals';

export const assertSkillName = (name: unknown): string => {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('Skill is missing a "name"');
  }
  if (!isSkillName(name)) {
    throw new Error(
      `Invalid skill name "${name}": use 1-${MAX_SKILL_NAME_LENGTH} lowercase letters, digits and single hyphens (e.g. "review-pull-request"), and not "evals"`,
    );
  }
  return name;
};

export const assertDescription = (name: string, description: unknown) => {
  if (typeof description !== 'string' || description.trim().length === 0) {
    throw new Error(`Skill "${name}" is missing a "description"`);
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(
      `Skill "${name}" description is ${description.length} characters; the limit is ${MAX_DESCRIPTION_LENGTH}`,
    );
  }
  return description;
};

/** Frontmatter `metadata` must map strings to strings (SEP-2640 wire schema). */
export const assertMetadata = (name: string, metadata: unknown) => {
  if (metadata === undefined) return;
  if (
    typeof metadata !== 'object' ||
    metadata === null ||
    Array.isArray(metadata)
  ) {
    throw new Error(`Skill "${name}" has a "metadata" that is not a mapping`);
  }
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value !== 'string') {
      throw new Error(
        `Skill "${name}" metadata "${key}" must be a string; quote its value in the frontmatter`,
      );
    }
  }
};

export const assertNamespace = (namespace: string): string => {
  const trimmed = namespace.replace(/^\/+|\/+$/g, '');
  for (const segment of trimmed.split('/')) {
    if (!PATH_SEGMENT.test(segment)) {
      throw new Error(
        `Invalid skill namespace "${namespace}": segments may contain letters, digits, ".", "_" and "-"`,
      );
    }
  }
  return trimmed;
};

export const assertFilePath = (skillName: string, filePath: string) => {
  const segments = filePath.split('/');
  if (
    filePath.startsWith('/') ||
    segments.some((segment) => segment === '' || segment === '..')
  ) {
    throw new Error(
      `Skill "${skillName}" has an invalid file path "${filePath}": use a relative path like "references/guide.md"`,
    );
  }
};

export const assertToolName = (name: unknown): string => {
  if (typeof name !== 'string' || !TOOL_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid tool name "${String(name)}": use 1-64 letters, digits, "_" or "-" (e.g. "lookup_order")`,
    );
  }
  return name;
};
