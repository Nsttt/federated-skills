import type {
  CallToolResult,
  JsonSchemaType,
  ServerContext,
  StandardSchemaWithJSON,
  ToolAnnotations,
} from '@modelcontextprotocol/server';

/** Frontmatter of a `SKILL.md` file, as defined by the Agent Skills format. */
export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  'allowed-tools'?: string;
  metadata?: Record<string, string>;
  [key: string]: unknown;
}

/** A file that belongs to a skill, after normalization. */
export type SkillFile =
  | { mimeType: string; text: string }
  | { mimeType: string; data: Uint8Array };

/**
 * Anything accepted as the content of a skill file. Strings are treated as
 * text and get a MIME type inferred from the file extension.
 */
export type SkillFileInput =
  | string
  | Uint8Array
  | { text: string; mimeType?: string }
  | { data: Uint8Array; mimeType?: string };

/** A normalized skill, as returned by {@link defineSkill}. */
export interface Skill {
  /** Path below `skill://`. Its last segment is always the skill name. */
  path: string;
  frontmatter: SkillFrontmatter;
  /** Every file of the skill keyed by relative path, including `SKILL.md`. */
  files: Record<string, SkillFile>;
}

/**
 * Tool input/output schema. Either a Standard Schema that can emit JSON Schema
 * (zod 4, valibot, arktype, ...) or a plain JSON Schema object.
 */
export type ToolSchema = StandardSchemaWithJSON | JsonSchemaType;

/** The handler input type inferred from a tool's `inputSchema`. */
export type InferToolInput<S> = S extends StandardSchemaWithJSON
  ? StandardSchemaWithJSON.InferOutput<S>
  : Record<string, unknown>;

export interface ToolContext {
  /** The provider that contributed the tool. */
  provider: { name: string; version?: string };
  /** Aborted when the client cancels the call. */
  signal: AbortSignal;
  /** The raw MCP request context, for advanced use (logging, elicitation, ...). */
  mcp: ServerContext;
}

/**
 * What a tool handler may return:
 * - a full MCP `CallToolResult` (passed through untouched)
 * - a string (sent as text)
 * - any other JSON value (sent as text, and as `structuredContent` for objects)
 * - nothing
 */
export type ToolHandlerResult =
  | CallToolResult
  | string
  | number
  | boolean
  | null
  | undefined
  | void
  | Record<string, unknown>
  | unknown[];

export interface SkillTool<S extends ToolSchema | undefined = undefined> {
  name: string;
  title?: string;
  description: string;
  inputSchema?: S;
  outputSchema?: ToolSchema;
  annotations?: ToolAnnotations;
  handler(
    input: InferToolInput<S>,
    context: ToolContext,
  ): ToolHandlerResult | Promise<ToolHandlerResult>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySkillTool = SkillTool<any>;

export const SKILLS_PROVIDER_KIND = 'module-federation/skills-provider';

/** A bundle of skills and tools, as returned by {@link defineSkillsProvider}. */
export interface SkillsProvider {
  kind: typeof SKILLS_PROVIDER_KIND;
  /** Defaults to the remote name when loaded through Module Federation. */
  name?: string;
  version?: string;
  skills: Skill[];
  tools: AnySkillTool[];
}
