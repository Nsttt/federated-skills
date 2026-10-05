import { createHash } from 'node:crypto';
import type { SkillEntry } from '../protocol';
import type {
  AnySkillTool,
  CallToolResult,
  JsonSchemaObject,
  Skill,
  SkillFile,
  SkillsProvider,
  ToolAnnotations,
  ToolContext,
  ToolSchema,
} from '../types';
import {
  assertDescription,
  assertFilePath,
  assertSkillName,
  assertToolName,
} from '../validate';
import {
  errorResult,
  toCallToolResult,
  toJsonSchema,
  validateToolInput,
} from './tools';

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

/** A tool as listed in MCP `tools/list`. */
export interface SkillsToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchemaObject;
  outputSchema?: JsonSchemaObject;
  annotations?: ToolAnnotations;
  /** Names the provider that contributed the tool. */
  _meta: Record<string, unknown>;
}

export interface CallToolOptions {
  /** Aborts the handler, e.g. when the client cancels the request. */
  signal?: AbortSignal;
  /** The MCP client making the call, passed on to the handler. */
  client?: ToolContext['client'];
}

/** The contents of a skill file, as returned by MCP `resources/read`. */
export type SkillResourceContents =
  | { uri: string; mimeType: string; text: string }
  | { uri: string; mimeType: string; blob: string };

/**
 * Every skill, file and tool from a set of providers, with what an MCP server
 * needs to serve them. Register it on any MCP server, or use one of the
 * adapters: `registerSkills()` from `./mcp` for the official MCP SDK, or the
 * layers in `./effect`.
 */
export interface SkillsCatalog {
  readonly providers: readonly ResolvedSkillsProvider[];
  /** SEP-2640 skill entries, in provider order. */
  readonly skills: readonly SkillEntry[];
  readonly resources: readonly CatalogResource[];
  readonly tools: readonly CatalogTool[];
  getSkill(uri: string): SkillEntry | undefined;
  getResource(uri: string): CatalogResource | undefined;
  /** Tool definitions with JSON Schema, for `tools/list`. */
  listTools(): SkillsToolDefinition[];
  /**
   * Run a tool for `tools/call`. Validates the arguments, and turns the
   * handler's return value, or the error it throws, into a tool result.
   * Throws only for an unknown tool name.
   */
  callTool(
    name: string,
    args: unknown,
    options?: CallToolOptions,
  ): Promise<CallToolResult>;
  /** A skill file for `resources/read`; binary files are base64-encoded. */
  readResource(uri: string): SkillResourceContents | undefined;
}

/** `_meta` key on each listed tool naming the provider it came from. */
export const PROVIDER_META_KEY = 'io.github.module-federation/provider';

const INVALID_PARAMS = -32602;

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

      const entryResources: Array<SkillEntry['resources'][number]> = [];
      const entry: SkillEntry = {
        uri,
        frontmatter: skill.frontmatter,
        resources: entryResources,
      };
      const filePaths = Object.keys(skill.files).sort((left, right) =>
        left === 'SKILL.md'
          ? -1
          : right === 'SKILL.md'
            ? 1
            : left.localeCompare(right),
      );
      for (const filePath of filePaths) {
        const file = skill.files[filePath];
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
        entryResources.push({
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
    listTools: () =>
      [...tools.values()].map(({ tool, provider }) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: toJsonSchema(
          tool.inputSchema as ToolSchema | undefined,
        ) ?? {
          type: 'object',
          properties: {},
        },
        outputSchema: toJsonSchema(tool.outputSchema),
        annotations: tool.annotations,
        _meta: { [PROVIDER_META_KEY]: provider.name },
      })),
    callTool: async (name, args, options = {}) => {
      const entry = tools.get(name);
      if (!entry) {
        // A JSON-RPC error code, which MCP servers pass through.
        throw Object.assign(new Error(`Unknown tool: ${name}`), {
          code: INVALID_PARAMS,
        });
      }
      const { tool, provider } = entry;
      // Invalid arguments are reported as tool errors (not protocol errors) so
      // the model can read the message and retry, as MCP recommends.
      const input = await validateToolInput(tool, args);
      if ('error' in input) return errorResult(new Error(input.error));
      try {
        return toCallToolResult(
          await tool.handler(input.value, {
            provider: { name: provider.name, version: provider.version },
            signal: options.signal ?? new AbortController().signal,
            client: options.client ?? { protocolVersion: 'unknown' },
          }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
    readResource: (uri) => {
      const resource = resources.get(uri);
      if (!resource) return undefined;
      const { file } = resource;
      return 'text' in file
        ? { uri, mimeType: file.mimeType, text: file.text }
        : {
            uri,
            mimeType: file.mimeType,
            blob: Buffer.from(file.data).toString('base64'),
          };
    },
  };
}
