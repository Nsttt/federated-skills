/**
 * Wire schemas for the MCP Skills extension (SEP-2640), as zod schemas. They
 * are Standard Schemas, so MCP clients can validate responses with them, e.g.
 * `client.request({ method: 'skills/list' }, ListSkillsResultSchema)` with the
 * official MCP TypeScript SDK.
 */
import * as z from 'zod';

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
  size: z.int().nonnegative(),
});

export const SkillEntrySchema = z.object({
  uri: z.string(),
  frontmatter: SkillFrontmatterSchema,
  resources: z.array(SkillResourceSchema),
});

const cacheFields = {
  ttlMs: z.int().nonnegative(),
  cacheScope: z.enum(['public', 'private']),
};

export const ListSkillsParamsSchema = z
  .looseObject({ cursor: z.string().optional() })
  .optional();

export const ListSkillsResultSchema = z.looseObject({
  skills: z.array(SkillEntrySchema),
  nextCursor: z.string().optional(),
  ...cacheFields,
});

export const GetSkillParamsSchema = z.looseObject({ uri: z.string() });

export const GetSkillResultSchema = z.looseObject({
  skill: SkillEntrySchema,
  ...cacheFields,
});

export type SkillEntry = z.infer<typeof SkillEntrySchema>;
export type SkillResource = z.infer<typeof SkillResourceSchema>;
export type ListSkillsResult = z.infer<typeof ListSkillsResultSchema>;
export type GetSkillResult = z.infer<typeof GetSkillResultSchema>;
