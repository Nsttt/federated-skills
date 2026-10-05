/** SEP-2640 wire schemas as Effect Schemas, for the Effect RPC definitions. */
import { Schema } from 'effect';

export const SkillFrontmatter = Schema.StructWithRest(
  Schema.Struct({
    name: Schema.String,
    description: Schema.String,
    license: Schema.optional(Schema.String),
    compatibility: Schema.optional(Schema.String),
    'allowed-tools': Schema.optional(Schema.String),
    metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);

export const SkillResource = Schema.Struct({
  uri: Schema.String,
  digest: Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/)),
  size: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export const SkillEntry = Schema.Struct({
  uri: Schema.String,
  frontmatter: SkillFrontmatter,
  resources: Schema.Array(SkillResource),
});

const cacheFields = {
  ttlMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  cacheScope: Schema.Literals(['public', 'private']),
};

export const ListSkillsParams = Schema.UndefinedOr(
  Schema.Struct({ cursor: Schema.optional(Schema.String) }),
);

export const ListSkillsResult = Schema.Struct({
  skills: Schema.Array(SkillEntry),
  nextCursor: Schema.optional(Schema.String),
  ...cacheFields,
});

export const GetSkillParams = Schema.Struct({ uri: Schema.String });

export const GetSkillResult = Schema.Struct({
  skill: SkillEntry,
  ...cacheFields,
});
