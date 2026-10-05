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
import type { CallToolResult, ToolContent } from '../types';
import type {
  CatalogResource,
  SkillsCatalog,
  SkillsToolDefinition,
} from '../catalog/catalog';
import {
  DEFAULT_SERVER_NAME,
  loadSkillsCatalog,
  resolveInstructions,
  type SkillsGatewayOptions as BaseGatewayOptions,
} from '../catalog/options';
import { allProtocols, withSkillsExtension } from './skills-extension';

export interface SkillsGatewayOptions extends BaseGatewayOptions {
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

const registerTool = (
  catalog: SkillsCatalog,
  definition: SkillsToolDefinition,
) =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    yield* server.addTool({
      tool: new McpSchema.Tool(definition),
      annotations: Context.empty(),
      handle: (payload) =>
        Effect.gen(function* () {
          const request = yield* McpSchema.McpRequestContext;
          const result: CallToolResult = yield* Effect.tryPromise({
            try: (signal) =>
              catalog.callTool(definition.name, payload, {
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
            catch: (error) => error,
          }).pipe(Effect.orDie);
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
  const instructions = resolveInstructions(catalog, options.instructions);

  const protocols = (options.protocols ?? allProtocols).map(
    withSkillsExtension(catalog, options.cache),
  );
  const [first, ...rest] = protocols;
  if (!first) {
    throw new Error('At least one MCP protocol revision is required');
  }

  const serverOptions: SkillsServerOptions = {
    name: options.name ?? DEFAULT_SERVER_NAME,
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
      for (const definition of catalog.listTools()) {
        yield* registerTool(catalog, definition);
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
  return createGatewayFromCatalog(
    await loadSkillsCatalog(options.providers, options),
    options,
  );
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
