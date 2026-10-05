import { Effect, Schema } from 'effect';
import { McpProtocol, McpSchema } from 'effect/ai';
import { Rpc, RpcGroup } from 'effect/rpc';
import {
  GetSkillParams,
  GetSkillResult,
  ListSkillsParams,
  ListSkillsResult,
} from './protocol';
import type { SkillsCatalog } from '../server/catalog';
import { resolveCacheHint, type SkillsCacheHint } from '../server/options';

/** Every MCP protocol revision Effect supports, newest first. */
export const allProtocols: ReadonlyArray<McpProtocol.ProtocolAdapter> = [
  McpProtocol.v2026_07_28,
  McpProtocol.v2025_11_25,
  McpProtocol.v2025_06_18,
  McpProtocol.v2025_03_26,
  McpProtocol.v2024_11_05,
];

// Stateless (2026-07-28+) results carry `resultType: "complete"`.
const complete = <S extends Schema.Struct<Schema.Struct.Fields>>(
  schema: S,
  stateless: boolean,
) =>
  stateless
    ? schema.mapFields((fields) => ({
        ...fields,
        resultType: Schema.Literal('complete'),
      }))
    : schema;

const makeRpcs = (stateless: boolean) =>
  RpcGroup.make(
    Rpc.make('skills/list', {
      payload: ListSkillsParams,
      success: complete(ListSkillsResult, stateless),
      error: McpSchema.InvalidParams,
    }),
    Rpc.make('skills/get', {
      payload: GetSkillParams,
      success: complete(GetSkillResult, stateless),
      error: McpSchema.InvalidParams,
    }),
  );

/**
 * The adapter fields Effect uses internally to install request handlers. They
 * are not part of the public `ProtocolAdapter` type, so this module checks for
 * them at runtime and fails loudly if a future Effect release changes them.
 */
interface InstallTarget {
  install: (
    protocol: McpProtocol.AnyProtocolAdapter,
    rpcs: RpcGroup.Any,
    handlers: unknown,
  ) => Effect.Effect<void>;
}

interface AdapterInternals {
  readonly handlerRpcs?: RpcGroup.RpcGroup<Rpc.Any>;
}

/**
 * Add the SEP-2640 `skills/list` and `skills/get` methods to an Effect MCP
 * protocol adapter.
 */
export const withSkillsExtension = (
  catalog: SkillsCatalog,
  cache: SkillsCacheHint = {},
) => {
  const cacheFields = resolveCacheHint(cache);

  return <A extends McpProtocol.ProtocolAdapter>(adapter: A): A => {
    const stateless = adapter.runtime._tag === 'Stateless';
    const rpcs = makeRpcs(stateless);
    const extra = stateless ? { resultType: 'complete' as const } : {};
    const { handlerRpcs } = adapter as A & AdapterInternals;

    const handlers = rpcs.of({
      'skills/list': () =>
        Effect.succeed({
          skills: [...catalog.skills],
          ...cacheFields,
          ...extra,
        }),
      'skills/get': ({ uri }) => {
        const skill = catalog.getSkill(uri);
        return skill
          ? Effect.succeed({ skill, ...cacheFields, ...extra })
          : Effect.fail(
              new McpSchema.InvalidParams({
                message: `Unknown skill URI: ${uri}`,
              }),
            );
      },
    });

    return {
      ...adapter,
      clientRpcs: (
        adapter.clientRpcs as unknown as RpcGroup.RpcGroup<Rpc.Any>
      ).merge(rpcs),
      ...(handlerRpcs ? { handlerRpcs: handlerRpcs.merge(rpcs) } : {}),
      installHandlers: (core: unknown, lifecycle: unknown, target: unknown) =>
        Effect.andThen(
          adapter.installHandlers(core, lifecycle, target),
          Effect.suspend(() => {
            const install = (target as Partial<InstallTarget>)?.install;
            if (typeof install !== 'function') {
              return Effect.die(
                new Error(
                  `@module-federation/federated-skills cannot register skills/* on MCP ${adapter.protocolVersion}: this Effect version changed its protocol adapter internals`,
                ),
              );
            }
            return install(adapter, rpcs, handlers);
          }),
        ),
    };
  };
};
