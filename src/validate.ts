const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;

export const MAX_SKILL_NAME_LENGTH = 64;
export const MAX_DESCRIPTION_LENGTH = 1024;

export const assertSkillName = (name: unknown): string => {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('Skill is missing a "name"');
  }
  if (name.length > MAX_SKILL_NAME_LENGTH || !SKILL_NAME.test(name)) {
    throw new Error(
      `Invalid skill name "${name}": use 1-${MAX_SKILL_NAME_LENGTH} lowercase letters, digits and single hyphens (e.g. "review-pull-request")`,
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
  if (typeof name !== 'string' || !TOOL_NAME.test(name)) {
    throw new Error(
      `Invalid tool name "${String(name)}": use 1-128 letters, digits, "_", "-" or "."`,
    );
  }
  return name;
};
