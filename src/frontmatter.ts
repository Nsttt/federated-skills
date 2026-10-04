import { parse, stringify } from 'yaml';

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export interface ParsedSkillMarkdown {
  frontmatter: Record<string, unknown>;
  body: string;
}

export const parseSkillMarkdown = (markdown: string): ParsedSkillMarkdown => {
  const source = markdown.replace(/^\uFEFF/, '');
  const match = FRONTMATTER.exec(source);
  if (!match) {
    throw new Error(
      'SKILL.md must start with a YAML frontmatter block (---\\nname: ...\\ndescription: ...\\n---)',
    );
  }
  const frontmatter: unknown = parse(match[1] ?? '');
  if (
    !frontmatter ||
    typeof frontmatter !== 'object' ||
    Array.isArray(frontmatter)
  ) {
    throw new Error('SKILL.md frontmatter must be a YAML mapping');
  }
  return {
    frontmatter: frontmatter as Record<string, unknown>,
    body: source.slice(match[0].length),
  };
};

export const renderSkillMarkdown = (
  frontmatter: Record<string, unknown>,
  body: string,
): string => {
  const defined = Object.fromEntries(
    Object.entries(frontmatter).filter(([, value]) => value !== undefined),
  );
  return `---\n${stringify(defined, { lineWidth: 0 }).trimEnd()}\n---\n\n${body.trim()}\n`;
};
