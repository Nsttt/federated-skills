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

/** A plain JSON Schema object describing a tool's arguments. */
export interface JsonSchemaObject {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

/**
 * The parts of the Standard Schema and Standard JSON Schema specs the gateway
 * uses. zod 4, valibot and arktype schemas all satisfy it.
 * See https://standardschema.dev.
 */
export interface StandardSchemaWithJSON<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
    readonly jsonSchema: {
      readonly input: (options: {
        readonly target: string;
      }) => Record<string, unknown>;
    };
    readonly types?: { readonly input: Input; readonly output: Output };
  };
}

export type StandardSchemaResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | {
      readonly issues: ReadonlyArray<{
        readonly message: string;
        readonly path?: ReadonlyArray<
          PropertyKey | { readonly key: PropertyKey }
        >;
      }>;
    };

/**
 * Tool input/output schema: a Standard Schema with JSON Schema support (zod 4,
 * valibot, arktype, ...) or a plain JSON Schema object.
 */
export type ToolSchema = StandardSchemaWithJSON | JsonSchemaObject;

/** The handler input type inferred from a tool's `inputSchema`. */
export type InferToolInput<S> =
  S extends StandardSchemaWithJSON<unknown, infer Output>
    ? Output
    : Record<string, unknown>;

/** MCP tool annotations (behavior hints for clients). */
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** An MCP content block. Binary data is base64-encoded. */
export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'audio'; data: string; mimeType: string }
  | {
      type: 'resource_link';
      uri: string;
      name: string;
      description?: string;
      mimeType?: string;
    }
  | {
      type: 'resource';
      resource:
        | { uri: string; mimeType?: string; text: string }
        | { uri: string; mimeType?: string; blob: string };
    };

/** A full MCP tool result. */
export interface CallToolResult {
  content: ToolContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface ToolContext {
  /** The provider that contributed the tool. */
  provider: { name: string; version?: string };
  /** Aborted when the client cancels the call or the server shuts down. */
  signal: AbortSignal;
  /** The MCP client making the call. */
  client: {
    protocolVersion: string;
    info?: { name: string; version: string };
  };
}

/**
 * What a tool handler may return:
 * - a full MCP {@link CallToolResult} (passed through)
 * - a string (sent as text)
 * - any other JSON value (sent as text, and as `structuredContent` for objects)
 * - nothing
 *
 * Throwing an error produces an `isError` result with the error message.
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
