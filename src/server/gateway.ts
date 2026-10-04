import {
  fromJsonSchema,
  McpServer,
  ProtocolError,
  ProtocolErrorCode,
  type CacheHint,
  type CallToolResult,
  type JsonSchemaType,
  type ServerContext,
  type StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import {
  serveStdio,
  type ServeStdioOptions,
  type StdioServerHandle,
} from '@modelcontextprotocol/server/stdio';
import { SKILLS_EXTENSION } from '../constants';
import {
  GetSkillParamsSchema,
  GetSkillResultSchema,
  ListSkillsParamsSchema,
  ListSkillsResultSchema,
} from '../protocol';
import type { ToolHandlerResult, ToolSchema } from '../types';
import {
  createSkillsCatalog,
  type CatalogTool,
  type SkillsCatalog,
} from './catalog';
import {
  loadSkillsProviders,
  type LoadProvidersOptions,
  type SkillsProviderSource,
} from './load';

export interface SkillsGatewayOptions extends LoadProvidersOptions {
  /** Where skills and tools come from. See {@link SkillsProviderSource}. */
  providers: readonly SkillsProviderSource[];
  /** MCP server name reported to clients. */
  name?: string;
  /** MCP server version reported to clients. */
  version?: string;
  /**
   * Instructions sent to clients on initialize. Defaults to a short index of
   * the available skills, which lets agents discover them even when their
   * client does not implement `skills/list` yet. Pass `false` to omit.
   */
  instructions?: string | false | ((catalog: SkillsCatalog) => string);
  /** Cache hint for skills and skill resources. Defaults to 5 minutes, public. */
  cache?: CacheHint;
}

export interface SkillsGateway {
  readonly catalog: SkillsCatalog;
  /** Create a new MCP server exposing the catalog. Use one per connection. */
  createServer(): McpServer;
  /** Add the catalog's skills, resources and tools to an existing server. */
  register(server: McpServer): McpServer;
  /** Serve over stdio, the transport most local MCP clients launch. */
  serveStdio(options?: ServeStdioOptions): StdioServerHandle;
}

const DEFAULT_CACHE = { ttlMs: 300_000, cacheScope: 'public' } as const;

export const defaultInstructions = (catalog: SkillsCatalog): string => {
  if (catalog.skills.length === 0) return '';
  const index = catalog.skills
    .map(
      (skill) =>
        `- ${skill.frontmatter.name}: ${skill.frontmatter.description} (${skill.uri})`,
    )
    .join('\n');
  return `This server provides agent skills. When a task matches a skill, read its SKILL.md resource first and follow it; supporting files are listed alongside it.\n\n${index}`;
};

const toStandardSchema = (
  schema: ToolSchema | undefined,
): StandardSchemaWithJSON | undefined => {
  if (!schema) return undefined;
  return '~standard' in schema
    ? (schema as StandardSchemaWithJSON)
    : fromJsonSchema(schema as JsonSchemaType);
};

const isCallToolResult = (value: unknown): value is CallToolResult =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as CallToolResult).content);

export const toCallToolResult = (value: ToolHandlerResult): CallToolResult => {
  if (isCallToolResult(value)) return value;
  if (value === undefined) return { content: [] };
  if (typeof value === 'string') {
    return { content: [{ type: 'text', text: value }] };
  }
  const text = JSON.stringify(value, null, 2);
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return {
      content: [{ type: 'text', text }],
      structuredContent: value as Record<string, unknown>,
    };
  }
  return { content: [{ type: 'text', text }] };
};

const registerTool = (server: McpServer, { tool, provider }: CatalogTool) => {
  const inputSchema = toStandardSchema(tool.inputSchema);
  const outputSchema = toStandardSchema(tool.outputSchema);
  const context = (mcp: ServerContext) => ({
    provider: { name: provider.name, version: provider.version },
    signal: mcp.mcpReq.signal,
    mcp,
  });
  const config = {
    title: tool.title,
    description: tool.description,
    inputSchema,
    outputSchema,
    annotations: tool.annotations,
    _meta: {
      'io.github.module-federation/provider': provider.name,
    },
  };

  // The MCP SDK passes parsed arguments only when an input schema exists.
  const callback = inputSchema
    ? async (input: unknown, mcp: ServerContext) =>
        toCallToolResult(await tool.handler(input, context(mcp)))
    : async (mcp: ServerContext) =>
        toCallToolResult(await tool.handler({}, context(mcp)));

  server.registerTool(
    tool.name,
    config as Parameters<McpServer['registerTool']>[1],
    callback as Parameters<McpServer['registerTool']>[2],
  );
};

export const registerSkills = (
  server: McpServer,
  catalog: SkillsCatalog,
  cache: CacheHint = DEFAULT_CACHE,
): McpServer => {
  const cacheFields = {
    ttlMs: cache.ttlMs ?? DEFAULT_CACHE.ttlMs,
    cacheScope: cache.cacheScope ?? DEFAULT_CACHE.cacheScope,
  };

  server.server.registerCapabilities({
    extensions: { [SKILLS_EXTENSION]: { directoryRead: false } },
  });

  server.server.setRequestHandler(
    'skills/list',
    { params: ListSkillsParamsSchema, result: ListSkillsResultSchema },
    async () => ({ skills: [...catalog.skills], ...cacheFields }),
  );

  server.server.setRequestHandler(
    'skills/get',
    { params: GetSkillParamsSchema, result: GetSkillResultSchema },
    async ({ uri }) => {
      const skill = catalog.getSkill(uri);
      if (!skill) {
        throw new ProtocolError(
          ProtocolErrorCode.InvalidParams,
          `Unknown skill URI: ${uri}`,
        );
      }
      return { skill, ...cacheFields };
    },
  );

  for (const resource of catalog.resources) {
    const { file } = resource;
    server.registerResource(
      resource.name,
      resource.uri,
      {
        mimeType: resource.mimeType,
        size: resource.size,
        description:
          resource.name === 'SKILL.md'
            ? resource.skill.frontmatter.description
            : `Supporting file of the ${resource.skill.frontmatter.name} skill`,
        cacheHint: cacheFields,
      },
      async (uri) => ({
        contents: [
          'text' in file
            ? { uri: uri.href, mimeType: file.mimeType, text: file.text }
            : {
                uri: uri.href,
                mimeType: file.mimeType,
                blob: Buffer.from(file.data).toString('base64'),
              },
        ],
      }),
    );
  }

  for (const tool of catalog.tools) {
    registerTool(server, tool);
  }

  return server;
};

/**
 * Load every provider and build an MCP gateway for them.
 *
 * @example
 * ```ts
 * const gateway = await createSkillsGateway({
 *   providers: [
 *     'billing@https://cdn.example.com/billing/mf-manifest.json',
 *     skillsDirectory('./skills'),
 *   ],
 * });
 * gateway.serveStdio();
 * ```
 */
export async function createSkillsGateway(
  options: SkillsGatewayOptions,
): Promise<SkillsGateway> {
  const providers = await loadSkillsProviders(options.providers, options);
  const catalog = createSkillsCatalog(providers);

  const instructions =
    options.instructions === false
      ? undefined
      : typeof options.instructions === 'string'
        ? options.instructions
        : (options.instructions ?? defaultInstructions)(catalog) || undefined;

  const gateway: SkillsGateway = {
    catalog,
    register: (server) => registerSkills(server, catalog, options.cache),
    createServer: () =>
      gateway.register(
        new McpServer(
          {
            name: options.name ?? 'module-federation-skills',
            version: options.version ?? __VERSION__,
          },
          { instructions },
        ),
      ),
    serveStdio: (stdioOptions) =>
      serveStdio(() => gateway.createServer(), stdioOptions),
  };
  return gateway;
}
