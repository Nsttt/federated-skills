import { createHash } from 'node:crypto';
import type { SkillEntry } from '../protocol';
import type { AnySkillTool, Skill, SkillFile, SkillsProvider } from '../types';
import {
  assertDescription,
  assertFilePath,
  assertSkillName,
  assertToolName,
} from '../validate';

/** A provider after loading, with a resolved name. */
export interface ResolvedSkillsProvider extends SkillsProvider {
  name: string;
  /** Where the provider came from, e.g. a manifest URL or a directory. */
  source: string;
}

export interface CatalogResource {
  uri: string;
  /** File name, used as the MCP resource name. */
  name: string;
  mimeType: string;
  size: number;
  digest: string;
  file: SkillFile;
  skill: SkillEntry;
  provider: ResolvedSkillsProvider;
}

export interface CatalogTool {
  tool: AnySkillTool;
  provider: ResolvedSkillsProvider;
}

export interface SkillsCatalog {
  readonly providers: readonly ResolvedSkillsProvider[];
  /** SEP-2640 skill entries, in provider order. */
  readonly skills: readonly SkillEntry[];
  readonly resources: readonly CatalogResource[];
  readonly tools: readonly CatalogTool[];
  getSkill(uri: string): SkillEntry | undefined;
  getResource(uri: string): CatalogResource | undefined;
}

const fileBytes = (file: SkillFile): Uint8Array =>
  'text' in file ? Buffer.from(file.text, 'utf8') : file.data;

const sha256 = (bytes: Uint8Array) =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const skillUri = (skillPath: string, filePath: string) =>
  `skill://${skillPath}/${filePath}`;

const validateSkill = (skill: Skill, providerName: string) => {
  const where = `provider "${providerName}"`;
  if (!skill || typeof skill !== 'object' || !skill.files) {
    throw new Error(`${where} contains an invalid skill; use defineSkill()`);
  }
  const name = assertSkillName(skill.frontmatter?.name);
  assertDescription(name, skill.frontmatter.description);
  if (skill.path.split('/').at(-1) !== name) {
    throw new Error(
      `Skill path "${skill.path}" in ${where} must end with the skill name "${name}"`,
    );
  }
  if (!skill.files['SKILL.md']) {
    throw new Error(`Skill "${name}" in ${where} has no SKILL.md`);
  }
  for (const filePath of Object.keys(skill.files)) {
    assertFilePath(name, filePath);
  }
};

/**
 * Merge providers into one catalog. Fails loudly on duplicate skill URIs and
 * tool names so a misconfigured provider never silently shadows another.
 */
export function createSkillsCatalog(
  providers: readonly ResolvedSkillsProvider[],
): SkillsCatalog {
  const skills = new Map<string, SkillEntry>();
  const skillOwners = new Map<string, string>();
  const resources = new Map<string, CatalogResource>();
  const tools = new Map<string, CatalogTool>();

  for (const provider of providers) {
    for (const skill of provider.skills) {
      validateSkill(skill, provider.name);
      const uri = skillUri(skill.path, 'SKILL.md');
      const owner = skillOwners.get(uri);
      if (owner) {
        throw new Error(
          `Skill ${uri} is provided by both "${owner}" and "${provider.name}"; give one of them a namespace`,
        );
      }

      const entry: SkillEntry = {
        uri,
        frontmatter: skill.frontmatter,
        resources: [],
      };
      const filePaths = Object.keys(skill.files).sort((left, right) =>
        left === 'SKILL.md'
          ? -1
          : right === 'SKILL.md'
            ? 1
            : left.localeCompare(right),
      );
      for (const filePath of filePaths) {
        const file = skill.files[filePath] as SkillFile;
        const bytes = fileBytes(file);
        const resource: CatalogResource = {
          uri: skillUri(skill.path, filePath),
          name: filePath.split('/').at(-1) ?? filePath,
          mimeType: file.mimeType,
          size: bytes.byteLength,
          digest: sha256(bytes),
          file,
          skill: entry,
          provider,
        };
        entry.resources.push({
          uri: resource.uri,
          digest: resource.digest,
          size: resource.size,
        });
        resources.set(resource.uri, resource);
      }

      skills.set(uri, entry);
      skillOwners.set(uri, provider.name);
    }

    for (const tool of provider.tools) {
      assertToolName(tool?.name);
      const existing = tools.get(tool.name);
      if (existing) {
        throw new Error(
          `Tool "${tool.name}" is provided by both "${existing.provider.name}" and "${provider.name}"`,
        );
      }
      if (typeof tool.handler !== 'function') {
        throw new Error(
          `Tool "${tool.name}" in provider "${provider.name}" has no handler`,
        );
      }
      tools.set(tool.name, { tool, provider });
    }
  }

  return {
    providers,
    skills: [...skills.values()],
    resources: [...resources.values()],
    tools: [...tools.values()],
    getSkill: (uri) => skills.get(uri),
    getResource: (uri) => resources.get(uri),
  };
}
