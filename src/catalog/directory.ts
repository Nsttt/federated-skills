import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { defineSkill, defineSkillsProvider } from '../define';
import { isExcludedSegment, isServedSkillFile } from '../manifest/paths';
import { decodeUtf8, isTextMimeType, mimeTypeFor } from '../mime';
import type { Skill, SkillFileInput, SkillsProvider } from '../types';

export interface SkillsDirectoryOptions {
  /** Provider name. Defaults to the directory name. */
  name?: string;
  version?: string;
  /** URI prefix applied to every skill in the directory. */
  namespace?: string;
}

// Served files only, by the same rule as the repo shape: `SKILL.md` plus
// regular files under references/, assets/ and scripts/, never a dot
// segment, node_modules, `evals` (any case), `*.map` or a symlink.
const listFiles = async (root: string, dir = root): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => !isExcludedSegment(entry.name))
      .map(async (entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) return listFiles(root, fullPath);
        return entry.isFile() ? [path.relative(root, fullPath)] : [];
      }),
  );
  return nested
    .flat()
    .filter((file) => isServedSkillFile(file.split(path.sep).join('/')));
};

const hasSkillFile = async (dir: string) =>
  stat(path.join(dir, 'SKILL.md')).then(
    (info) => info.isFile(),
    () => false,
  );

const readSkill = async (
  skillDir: string,
  namespace: string | undefined,
): Promise<Skill> => {
  const files: Record<string, SkillFileInput> = {};
  for (const relativePath of await listFiles(skillDir)) {
    const filePath = relativePath.split(path.sep).join('/');
    if (filePath === 'SKILL.md') continue;
    const bytes = new Uint8Array(
      await readFile(path.join(skillDir, relativePath)),
    );
    const mimeType = mimeTypeFor(filePath);
    // Text that is not valid UTF-8 is served as a blob, so its digest still
    // covers the bytes on disk.
    const text = isTextMimeType(mimeType) ? decodeUtf8(bytes) : undefined;
    files[filePath] =
      text === undefined ? { data: bytes, mimeType } : { text, mimeType };
  }
  const markdown = await readFile(path.join(skillDir, 'SKILL.md'), 'utf8');
  try {
    const skill = defineSkill({ markdown, namespace, files });
    const folder = path.basename(skillDir);
    if (skill.frontmatter.name !== folder) {
      throw new Error(
        `the skill is named "${skill.frontmatter.name}" but its folder is "${folder}"; rename one so they match`,
      );
    }
    return skill;
  } catch (error) {
    throw new Error(
      `${path.join(skillDir, 'SKILL.md')}: ${(error as Error).message}`,
      {
        cause: error,
      },
    );
  }
};

/**
 * Serve skills straight from disk, using the standard Agent Skills layout:
 * `<dir>/<skill-name>/SKILL.md` plus the files under `references/`,
 * `assets/` and `scripts/`. Like a Zephyr deploy, it never serves `evals/`,
 * source maps, dot files or other top-level entries. `dir` may also be a
 * single skill folder.
 *
 * @example
 * ```ts
 * createSkillsGateway({ providers: [skillsDirectory('./skills')] });
 * ```
 */
export function skillsDirectory(
  dir: string,
  options: SkillsDirectoryOptions = {},
): () => Promise<SkillsProvider> {
  return async () => {
    const root = path.resolve(dir);
    const skillDirs = (await hasSkillFile(root))
      ? [root]
      : (
          await Promise.all(
            (await readdir(root, { withFileTypes: true }))
              .filter((entry) => entry.isDirectory())
              .map(async (entry) => {
                const skillDir = path.join(root, entry.name);
                return (await hasSkillFile(skillDir)) ? skillDir : undefined;
              }),
          )
        ).filter((skillDir) => skillDir !== undefined);

    if (skillDirs.length === 0) {
      throw new Error(
        `No skills found in ${root}; expected <skill-name>/SKILL.md folders`,
      );
    }

    return defineSkillsProvider({
      name: options.name ?? path.basename(root),
      version: options.version,
      skills: await Promise.all(
        skillDirs
          .sort()
          .map((skillDir) => readSkill(skillDir, options.namespace)),
      ),
    });
  };
}
