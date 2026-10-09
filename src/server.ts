/**
 * Serve a skills catalog with the official MCP TypeScript SDK
 * (`@modelcontextprotocol/server`).
 */
import {
  CLIENT_INFO_META_KEY,
  createMcpHandler,
  McpServer,
  originValidationResponse,
  PROTOCOL_VERSION_META_KEY,
  type ServerContext,
  type StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { SKILLS_EXTENSION } from './constants';
import { GetSkillParamsSchema, ListSkillsParamsSchema } from './protocol';
import type { SkillsCatalog } from './catalog/catalog';
import {
  DEFAULT_SERVER_NAME,
  resolveCacheHint,
  resolveInstructions,
  type SkillsCacheHint,
  type SkillsGatewayOptions,
  type SkillsServeOptions,
} from './catalog/options';
import { loadSkillsCatalog } from './catalog/load';
import type { CallToolResult, JsonSchemaObject, ToolContext } from './types';

export interface RegisterSkillsOptions {
  /** Cache hint for `skills/list`, `skills/get` and skill files. Defaults to 5 minutes, public. */
  cache?: SkillsCacheHint;
}

// Advertises a tool's JSON Schema and leaves validation to the catalog, so
// every adapter reports invalid arguments the same way.
const describedBy = (
  schema: JsonSchemaObject,
): StandardSchemaWithJSON<Record<string, unknown>> => ({
  '~standard': {
    version: 1,
    vendor: 'federated-skills',
    validate: (value) => ({ value: value as Record<string, unknown> }),
    jsonSchema: { input: () => schema, output: () => schema },
  },
});

const INVALID_PARAMS = -32602;

const clientOf = (
  server: McpServer,
  ctx: ServerContext,
): ToolContext['client'] => {
  // 2026-07-28 requests carry the client in their envelope. Older sessions
  // negotiate it once, except the SDK's stateless HTTP fallback for them,
  // which only has the version header.
  // tsc 6 needs this assertion; Rslint's TypeScript 7 checker does not.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const envelope = ctx.mcpReq.envelope as
    | {
        [PROTOCOL_VERSION_META_KEY]?: string;
        [CLIENT_INFO_META_KEY]?: { name: string; version: string };
      }
    | undefined;
  const info =
    envelope?.[CLIENT_INFO_META_KEY] ?? server.server.getClientVersion();
  return {
    protocolVersion:
      envelope?.[PROTOCOL_VERSION_META_KEY] ??
      server.server.getNegotiatedProtocolVersion() ??
      ctx.http?.req?.headers.get('mcp-protocol-version') ??
      'unknown',
    info: info && { name: info.name, version: info.version },
  };
};

/**
 * Register a catalog's skills and tools on an `McpServer` you own, next to
 * your own tools, resources and prompts:
 * - each skill file as a resource,
 * - each tool,
 * - the SEP-2640 `skills/list` and `skills/get` methods and the
 *   `io.modelcontextprotocol/skills` extension capability.
 *
 * Call it before connecting the server. Pass `defaultInstructions(catalog)`
 * as the server's `instructions` to index the skills for clients that do
 * not implement `skills/list` yet.
 *
 * @example
 * ```ts
 * const catalog = await loadSkillsCatalog(['billing@https://cdn.example.com/billing/mf-manifest.json']);
 * const server = new McpServer(
 *   { name: 'acme', version: '1.0.0' },
 *   { instructions: defaultInstructions(catalog) },
 * );
 * registerSkills(server, catalog);
 * ```
 */
export function registerSkills(
  server: McpServer,
  catalog: SkillsCatalog,
  options: RegisterSkillsOptions = {},
): void {
  const cacheHint = resolveCacheHint(options.cache);

  for (const resource of catalog.resources) {
    server.registerResource(
      resource.name,
      resource.uri,
      {
        description:
          resource.name === 'SKILL.md'
            ? resource.skill.frontmatter.description
            : `Supporting file of the ${resource.skill.frontmatter.name} skill`,
        mimeType: resource.mimeType,
        size: resource.size,
        cacheHint,
      },
      () => ({ contents: [catalog.readResource(resource.uri)!] }),
    );
  }

  for (const definition of catalog.listTools()) {
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: describedBy(definition.inputSchema),
        outputSchema:
          definition.outputSchema && describedBy(definition.outputSchema),
        annotations: definition.annotations,
        _meta: definition._meta,
      },
      async (args, ctx) =>
        (await catalog.callTool(definition.name, args, {
          signal: ctx.mcpReq.signal,
          client: clientOf(server, ctx),
        })) as CallToolResult & Record<string, unknown>,
    );
  }

  server.server.registerCapabilities({
    extensions: { [SKILLS_EXTENSION]: { directoryRead: false } },
  });
  server.server.setRequestHandler(
    'skills/list',
    { params: ListSkillsParamsSchema },
    () => ({ skills: [...catalog.skills], ...cacheHint }),
  );
  server.server.setRequestHandler(
    'skills/get',
    { params: GetSkillParamsSchema },
    ({ uri }) => {
      const skill = catalog.getSkill(uri);
      if (!skill) {
        throw Object.assign(new Error(`Unknown skill URI: ${uri}`), {
          code: INVALID_PARAMS,
        });
      }
      return { skill, ...cacheHint };
    },
  );
}

/** A new `McpServer` that serves the catalog and nothing else. */
export function createSkillsServer(
  catalog: SkillsCatalog,
  options: SkillsServeOptions = {},
): McpServer {
  const instructions = resolveInstructions(catalog, options.instructions);
  const server = new McpServer(
    {
      name: options.name ?? DEFAULT_SERVER_NAME,
      version: options.version ?? __VERSION__,
    },
    instructions === undefined ? {} : { instructions },
  );
  registerSkills(server, catalog, { cache: options.cache });
  return server;
}

export interface SkillsWebHandlerOptions {
  /**
   * Hostnames allowed in the `Origin` header of browser requests. Requests
   * without an `Origin` header (most MCP clients) are always allowed.
   */
  allowedOriginHostnames?: string[];
}

export interface SkillsGateway {
  readonly catalog: SkillsCatalog;
  /** A new `McpServer` for the catalog, e.g. for a transport of your own. */
  createServer(): McpServer;
  /**
   * A web-standard `(Request) => Promise<Response>` Streamable HTTP handler,
   * for any runtime or framework that speaks `fetch` (Node, Bun, Deno,
   * Workers, Hono, ...). Serves every MCP revision the SDK supports.
   */
  toWebHandler(options?: SkillsWebHandlerOptions): {
    readonly handler: (request: Request) => Promise<Response>;
    readonly dispose: () => Promise<void>;
  };
  /** Serve over stdio until the client disconnects. */
  serveStdio(): Promise<void>;
}

/** A ready-made gateway for a catalog. */
export function createGatewayFromCatalog(
  catalog: SkillsCatalog,
  options: SkillsServeOptions = {},
): SkillsGateway {
  const createServer = () => createSkillsServer(catalog, options);
  return {
    catalog,
    createServer,
    toWebHandler: ({ allowedOriginHostnames } = {}) => {
      const http = createMcpHandler(createServer);
      return {
        handler: async (request) =>
          (allowedOriginHostnames &&
            originValidationResponse(request, allowedOriginHostnames)) ||
          http.fetch(request),
        dispose: () => http.close(),
      };
    },
    serveStdio: () =>
      new Promise((resolve) => {
        const handle = serveStdio(createServer, {
          onerror: (error) =>
            console.error(`[federated-skills] ${error.message}`),
        });
        // The client closing stdin ends the session: a normal exit.
        process.stdin.once('end', () => {
          void handle.close().then(() => resolve());
        });
      }),
  };
}

/**
 * Load every provider and build a ready-made MCP gateway for them.
 *
 * @example
 * ```ts
 * const gateway = await createSkillsGateway({
 *   providers: [
 *     'billing@https://cdn.example.com/billing/mf-manifest.json',
 *     skillsDirectory('./skills'),
 *   ],
 * });
 * await gateway.serveStdio();
 * ```
 */
export async function createSkillsGateway(
  options: SkillsGatewayOptions,
): Promise<SkillsGateway> {
  return createGatewayFromCatalog(
    await loadSkillsCatalog(options.providers, options),
    options,
  );
}

export type { SkillsGatewayOptions, SkillsServeOptions };
