import { NodeStdio } from '@effect/platform-node';
import {
  Cause,
  Context,
  Data,
  Effect,
  Exit,
  Layer,
  Logger,
  type Stdio,
} from 'effect';
import { McpSchema, McpServer, type McpProtocol } from 'effect/ai';
import { HttpRouter } from 'effect/http';
import { SKILLS_EXTENSION } from '../constants';
import type {
  CallToolResult,
  JsonSchemaObject,
  StandardSchemaWithJSON,
  ToolContent,
  ToolHandlerResult,
  ToolSchema,
} from '../types';
import {
  createSkillsCatalog,
  type CatalogResource,
  type CatalogTool,
  type SkillsCatalog,
} from './catalog';
import {
  loadSkillsProviders,
  type LoadProvidersOptions,
  type SkillsProviderSource,
} from './load';
import {
  allProtocols,
  withSkillsExtension,
  type SkillsCacheHint,
} from './skills-extension';

export interface SkillsGatewayOptions extends LoadProvidersOptions {
  /** Where skills and tools come from. See {@link SkillsProviderSource}. */
  providers: readonly SkillsProviderSource[];
  /** MCP server name reported to clients. */
  name?: string;
  /** MCP server version reported to clients. */
  version?: string;
  /**
   * Instructions sent to clients on connect. Defaults to a short index of the
   * available skills, which lets agents discover them even when their client
   * does not implement `skills/list` yet. Pass `false` to omit.
   */
  instructions?: string | false | ((catalog: SkillsCatalog) => string);
  /** Cache hint for `skills/list` and `skills/get`. Defaults to 5 minutes, public. */
  cache?: SkillsCacheHint;
  /**
   * MCP protocol revisions to serve. Defaults to every revision Effect
   * supports; the Skills capability is advertised from 2026-07-28 onwards.
   */
  protocols?: ReadonlyArray<McpProtocol.ProtocolAdapter>;
}

/** Options for `McpServer.layer`, `layerStdio` and `layerHttp` from `effect/ai`. */
export interface SkillsServerOptions {
  readonly name: string;
  readonly version: string;
  readonly instructions?: string;
  readonly protocols: readonly [
    McpProtocol.ProtocolAdapter,
    ...McpProtocol.ProtocolAdapter[],
  ];
  readonly extensions: {
    readonly 'io.modelcontextprotocol/skills': {
      readonly directoryRead: boolean;
    };
  };
}

export interface SkillsHttpOptions {
  /** Route of the MCP endpoint. Defaults to `/mcp`. */
  path?: HttpRouter.PathInput;
  /** Origins allowed to call the endpoint from a browser. */
  allowedOrigins?: ReadonlyArray<string>;
}

export interface SkillsGateway {
  readonly catalog: SkillsCatalog;
  /**
   * Everything needed to build an Effect `McpServer` that speaks the Skills
   * extension: name, version, instructions, protocol adapters with
   * `skills/list` and `skills/get`, and the extension capability.
   */
  readonly serverOptions: SkillsServerOptions;
  /** Registers the catalog's resources and tools on an Effect `McpServer`. */
  readonly layer: Layer.Layer<never, never, McpServer.McpServer>;
  /** A complete stdio MCP server. Provide `Stdio` (e.g. `NodeStdio.layer`). */
  layerStdio(): Layer.Layer<
    McpServer.McpServer | McpSchema.McpServerClient,
    unknown,
    Stdio.Stdio
  >;
  /** A complete Streamable HTTP MCP server mounted on an `HttpRouter`. */
  layerHttp(
    options?: SkillsHttpOptions,
  ): Layer.Layer<
    McpServer.McpServer | McpSchema.McpServerClient,
    unknown,
    HttpRouter.HttpRouter
  >;
  /**
   * A web-standard `(Request) => Promise<Response>` handler, for any runtime
   * or framework that speaks `fetch` (Node, Bun, Deno, Workers, Hono, ...).
   */
  toWebHandler(options?: SkillsHttpOptions): {
    readonly handler: (request: Request) => Promise<Response>;
    readonly dispose: () => Promise<void>;
  };
  /** Serve over stdio until the client disconnects. Logs go to stderr. */
  serveStdio(): Promise<void>;
}

/** A provider failed to load, or providers conflict with each other. */
export class FederatedSkillsError extends Data.TaggedError(
  'FederatedSkillsError',
)<{ readonly message: string; readonly cause?: unknown }> {}

const PROVIDER_META_KEY = 'io.github.module-federation/provider';

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

const isStandardSchema = (
  schema: ToolSchema,
): schema is StandardSchemaWithJSON => '~standard' in schema;

const toJsonSchema = (
  schema: ToolSchema | undefined,
): JsonSchemaObject | undefined => {
  if (!schema) return undefined;
  const json = isStandardSchema(schema)
    ? schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' })
    : { ...schema };
  delete json['$schema'];
  return json as JsonSchemaObject;
};

const formatIssues = (
  issues: ReadonlyArray<{
    message: string;
    path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>;
  }>,
) =>
  issues
    .map((issue) => {
      const path = (issue.path ?? [])
        .map((segment) =>
          typeof segment === 'object' ? String(segment.key) : String(segment),
        )
        .join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');

// Invalid arguments are reported as tool errors (not protocol errors) so the
// model can read the message and retry, as MCP 2025-11-25 recommends.
const validateInput = (
  tool: CatalogTool['tool'],
  payload: unknown,
): Effect.Effect<{ value: unknown } | { error: string }> => {
  const schema = tool.inputSchema as ToolSchema | undefined;
  // Plain JSON Schema is advertised to clients but not validated here.
  if (!schema || !isStandardSchema(schema)) {
    return Effect.succeed({ value: payload ?? {} });
  }
  return Effect.promise(async () =>
    schema['~standard'].validate(payload ?? {}),
  ).pipe(
    Effect.map((result) =>
      result.issues
        ? {
            error: `Invalid arguments for tool "${tool.name}": ${formatIssues(result.issues)}`,
          }
        : { value: result.value },
    ),
  );
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

const fromBase64 = (data: string) =>
  new Uint8Array(Buffer.from(data, 'base64'));

// Effect's MCP schemas carry binary data as bytes rather than base64.
const toEffectContent = (block: ToolContent) => {
  switch (block.type) {
    case 'image':
    case 'audio':
      return { ...block, data: fromBase64(block.data) };
    case 'resource':
      return 'blob' in block.resource
        ? {
            ...block,
            resource: {
              ...block.resource,
              blob: fromBase64(block.resource.blob),
            },
          }
        : block;
    default:
      return block;
  }
};

const errorResult = (error: unknown): CallToolResult => ({
  isError: true,
  content: [
    {
      type: 'text',
      text: error instanceof Error ? error.message : String(error),
    },
  ],
});

const registerTool = ({ tool, provider }: CatalogTool) =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    yield* server.addTool({
      tool: new McpSchema.Tool({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: toJsonSchema(tool.inputSchema) ?? {
          type: 'object',
          properties: {},
        },
        outputSchema: toJsonSchema(tool.outputSchema),
        annotations: tool.annotations,
        _meta: { [PROVIDER_META_KEY]: provider.name },
      }),
      annotations: Context.empty(),
      handle: (payload) =>
        Effect.gen(function* () {
          const input = yield* validateInput(tool, payload);
          const request = yield* McpSchema.McpRequestContext;
          const result: CallToolResult =
            'error' in input
              ? errorResult(new Error(input.error))
              : yield* Effect.tryPromise({
                  try: async (signal) =>
                    toCallToolResult(
                      await tool.handler(input.value, {
                        provider: {
                          name: provider.name,
                          version: provider.version,
                        },
                        signal,
                        client: {
                          protocolVersion: request.protocolVersion,
                          info: request.clientInfo
                            ? {
                                name: request.clientInfo.name,
                                version: request.clientInfo.version,
                              }
                            : undefined,
                        },
                      }),
                    ),
                  catch: (error) => error,
                }).pipe(
                  Effect.catch((error) => Effect.succeed(errorResult(error))),
                );
          return new McpSchema.CallToolResult({
            ...result,
            content: result.content.map(toEffectContent),
          } as ConstructorParameters<typeof McpSchema.CallToolResult>[0]);
        }),
    });
  });

const registerResource = (resource: CatalogResource) =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const { file } = resource;
    const description =
      resource.name === 'SKILL.md'
        ? resource.skill.frontmatter.description
        : `Supporting file of the ${resource.skill.frontmatter.name} skill`;
    yield* server.addResource({
      resource: new McpSchema.Resource({
        uri: resource.uri,
        name: resource.name,
        description,
        mimeType: resource.mimeType,
        size: resource.size,
      }),
      annotations: Context.empty(),
      handle: Effect.sync(() =>
        McpSchema.ReadResourceResult.make({
          contents: [
            'text' in file
              ? { uri: resource.uri, mimeType: file.mimeType, text: file.text }
              : { uri: resource.uri, mimeType: file.mimeType, blob: file.data },
          ],
        }),
      ),
    });
  });

/** Build a gateway from an already-loaded catalog. */
export function createGatewayFromCatalog(
  catalog: SkillsCatalog,
  options: Omit<SkillsGatewayOptions, 'providers'> = {},
): SkillsGateway {
  const instructions =
    options.instructions === false
      ? undefined
      : typeof options.instructions === 'string'
        ? options.instructions
        : (options.instructions ?? defaultInstructions)(catalog) || undefined;

  const protocols = (options.protocols ?? allProtocols).map(
    withSkillsExtension(catalog, options.cache),
  );
  const [first, ...rest] = protocols;
  if (!first) {
    throw new Error('At least one MCP protocol revision is required');
  }

  const serverOptions: SkillsServerOptions = {
    name: options.name ?? 'module-federation-skills',
    version: options.version ?? __VERSION__,
    ...(instructions === undefined ? {} : { instructions }),
    protocols: [first, ...rest],
    extensions: { [SKILLS_EXTENSION]: { directoryRead: false } },
  };

  const layer = Layer.effectDiscard(
    Effect.gen(function* () {
      for (const resource of catalog.resources) {
        yield* registerResource(resource);
      }
      for (const tool of catalog.tools) {
        yield* registerTool(tool);
      }
    }),
  );

  const layerHttp = ({
    path = '/mcp',
    allowedOrigins,
  }: SkillsHttpOptions = {}) =>
    layer.pipe(
      Layer.provideMerge(
        McpServer.layerHttp({ ...serverOptions, path, allowedOrigins }),
      ),
    );

  const layerStdio = () =>
    layer.pipe(Layer.provideMerge(McpServer.layerStdio(serverOptions)));

  return {
    catalog,
    serverOptions,
    layer,
    layerStdio,
    layerHttp,
    toWebHandler: (httpOptions) =>
      HttpRouter.toWebHandler(layerHttp(httpOptions), { disableLogger: true }),
    serveStdio: async () => {
      const exit = await Effect.runPromiseExit(
        Layer.launch(
          layerStdio().pipe(
            Layer.provide(NodeStdio.layer),
            Layer.provide(
              Logger.layer([Logger.withConsoleError(Logger.formatSimple)]),
            ),
          ),
        ),
      );
      // The server is interrupted when the client closes stdin: a normal exit.
      if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
        throw Cause.squash(exit.cause);
      }
    },
  };
}

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
 * await gateway.serveStdio();
 * ```
 */
export async function createSkillsGateway(
  options: SkillsGatewayOptions,
): Promise<SkillsGateway> {
  const providers = await loadSkillsProviders(options.providers, options);
  return createGatewayFromCatalog(createSkillsCatalog(providers), options);
}

/** {@link createSkillsGateway} as an Effect, failing with {@link FederatedSkillsError}. */
export const makeSkillsGateway = (
  options: SkillsGatewayOptions,
): Effect.Effect<SkillsGateway, FederatedSkillsError> =>
  Effect.tryPromise({
    try: () => createSkillsGateway(options),
    catch: (error) =>
      new FederatedSkillsError({
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      }),
  });
