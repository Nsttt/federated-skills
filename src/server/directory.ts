import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { defineSkill, defineSkillsProvider } from '../define';
import { inferMimeType, isTextMimeType } from '../mime';
import type { Skill, SkillFileInput, SkillsProvider } from '../types';

export interface SkillsDirectoryOptions {
  /** Provider name. Defaults to the directory name. */
  name?: string;
  version?: string;
  /** URI prefix applied to every skill in the directory. */
  namespace?: string;
}

const IGNORED = new Set(['node_modules', '.git', '.DS_Store']);

const listFiles = async (root: string, dir = root): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter(
        (entry) => !entry.name.startsWith('.') && !IGNORED.has(entry.name),
      )
      .map(async (entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) return listFiles(root, fullPath);
        return entry.isFile() ? [path.relative(root, fullPath)] : [];
      }),
  );
  return nested.flat();
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
    const bytes = await readFile(path.join(skillDir, relativePath));
    const mimeType = inferMimeType(filePath);
    files[filePath] = isTextMimeType(mimeType)
      ? { text: bytes.toString('utf8'), mimeType }
      : { data: new Uint8Array(bytes), mimeType };
  }
  const markdown = await readFile(path.join(skillDir, 'SKILL.md'), 'utf8');
  try {
    return defineSkill({ markdown, namespace, files });
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
 * `<dir>/<skill-name>/SKILL.md` plus any supporting files. `dir` may also be a
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
