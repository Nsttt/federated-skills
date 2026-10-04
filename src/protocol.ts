/**
 * Wire schemas for the MCP Skills extension (SEP-2640). Use them on the client
 * side with `client.request({ method: 'skills/list' }, ListSkillsResultSchema)`.
 */
import * as z from 'zod/v4';

export { SKILLS_EXTENSION } from './constants';

export const SkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  license: z.string().optional(),
  compatibility: z.string().optional(),
  'allowed-tools': z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

export const SkillResourceSchema = z.object({
  uri: z.string(),
  digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  size: z.number().int().nonnegative(),
});

export const SkillEntrySchema = z.object({
  uri: z.string(),
  frontmatter: SkillFrontmatterSchema,
  resources: z.array(SkillResourceSchema),
});

const CacheFields = {
  ttlMs: z.number().int().nonnegative(),
  cacheScope: z.enum(['public', 'private']),
};

export const ListSkillsParamsSchema = z.object({
  cursor: z.string().optional(),
});

export const ListSkillsResultSchema = z.object({
  skills: z.array(SkillEntrySchema),
  nextCursor: z.string().optional(),
  ...CacheFields,
});

export const GetSkillParamsSchema = z.object({
  uri: z.string(),
});

export const GetSkillResultSchema = z.object({
  skill: SkillEntrySchema,
  ...CacheFields,
});

export type SkillEntry = z.infer<typeof SkillEntrySchema>;
export type SkillResource = z.infer<typeof SkillResourceSchema>;
export type ListSkillsResult = z.infer<typeof ListSkillsResultSchema>;
export type GetSkillResult = z.infer<typeof GetSkillResultSchema>;
