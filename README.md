# @module-federation/mcp

Ship [agent skills](https://agentskills.io) and tools from Module Federation
remotes, and serve them all through one MCP server.

Each team publishes a **skills provider**: a federated remote that bundles
`SKILL.md` files, supporting files, and the JavaScript tools those skills
describe. A **gateway** loads the providers at startup and exposes them over
the Model Context Protocol, including the Skills extension (SEP-2640). Use
the ready-made gateway, or add the skills to an MCP server you already run. MCP
clients see ordinary skills, resources and tools. They don't need to know
Module Federation is involved.

```bash
pnpm add @module-federation/mcp
```

[`examples/`](./examples) is a company setup you can run locally: three teams
ship skills from Rsbuild and Rspack projects, and a platform team serves them
all through one gateway with a team registry, an audit log and a CI check.

## Write a provider

```ts
// src/skills.ts
import {
  defineSkill,
  defineSkillsProvider,
  defineTool,
} from '@module-federation/mcp';
import * as z from 'zod';
import skillMd from './release-checklist/SKILL.md?raw';
import gates from './release-checklist/references/gates.md?raw';

export default defineSkillsProvider({
  version: '1.4.0',
  skills: [
    // Reuse an existing SKILL.md, served byte-for-byte...
    defineSkill({
      markdown: skillMd,
      files: { 'references/gates.md': gates },
    }),
    // ...or write one inline and let the SDK generate the SKILL.md.
    defineSkill({
      name: 'rollback',
      description: 'Use when a release must be reverted.',
      instructions: '# Rollback\n\n1. Call `lookup_release` ...',
    }),
  ],
  tools: [
    defineTool({
      name: 'lookup_release',
      description: 'Fetch a release by version.',
      inputSchema: z.object({ version: z.string() }),
      annotations: { readOnlyHint: true },
      async handler({ version }, { provider, signal }) {
        return await releases.get(version, { signal }); // objects become structuredContent
      },
    }),
  ],
});
```

- `inputSchema` and `outputSchema` take any Standard Schema with JSON Schema
  support (zod 4, valibot, arktype) or a plain JSON Schema object. Handler
  input types are inferred.
- Handlers can return a string, a JSON value, nothing, or a full MCP
  `CallToolResult`.
- Skill names, descriptions and file paths are validated against the Agent
  Skills format when you define them, with errors that tell you what to fix.
- `namespace: 'acme/payments'` publishes a skill at
  `skill://acme/payments/<name>/SKILL.md` so providers never collide.

## Build a provider

Build providers with Rsbuild. `pluginFederatedSkills` adds a Node environment
that builds your provider as a Module Federation remote. It uses the official
[`@module-federation/rsbuild-plugin`](https://module-federation.io/guide/build-plugins/plugins-rsbuild),
so the output is an ordinary Rsbuild Node remote with an `mf-manifest.json`,
exposing your provider as `./skills`. `?raw` imports return file contents as
strings.

```bash
pnpm add -D @rsbuild/core @module-federation/rsbuild-plugin
```

```ts
// rsbuild.config.ts
import { defineConfig } from '@rsbuild/core';
import { pluginFederatedSkills } from '@module-federation/mcp/rsbuild';

export default defineConfig({
  plugins: [
    pluginFederatedSkills({ name: 'releases', provider: './src/skills.ts' }),
  ],
});
```

`rsbuild build` writes the remote to `dist/`. Deploy it anywhere that serves
static files and point gateways at `releases@https://<host>/mf-manifest.json`.
`rsbuild dev` and `rsbuild preview` serve it too, so a local gateway can load
`releases@http://localhost:3000/mf-manifest.json`. Restart the gateway to
pick up changes.

You don't need an entry. The plugin sets the asset prefix of the provider
environment to `auto`, so chunks load from wherever the manifest is served.

| Option        | Default                                 | Description                                                        |
| ------------- | --------------------------------------- | ------------------------------------------------------------------ |
| `provider`    | required                                | Module whose default export is `defineSkillsProvider(...)`         |
| `name`        | the app's `pluginModuleFederation` name | Remote name                                                        |
| `expose`      | `'./skills'`                            | Exposed module key                                                 |
| `environment` | `'skills'`                              | Rsbuild environment that builds the provider                       |
| `federation`  | `{}`                                    | Extra Module Federation options, e.g. `shared` or `runtimePlugins` |

### Next to an existing app or remote

Add the plugin to a project that already builds something, such as a web app
or a web remote with `pluginModuleFederation`. That build stays as it was, and
the provider goes to `dist/skills/`. Without a `name`, the provider takes the
name of the app's remote:

```ts
// rsbuild.config.ts
import { defineConfig } from '@rsbuild/core';
import { pluginModuleFederation } from '@module-federation/rsbuild-plugin';
import { pluginFederatedSkills } from '@module-federation/mcp/rsbuild';

export default defineConfig({
  plugins: [
    pluginModuleFederation({
      name: 'billing',
      exposes: { './checkout': './src/checkout.tsx' },
      shared: ['react', 'react-dom'],
    }),
    pluginFederatedSkills({ provider: './src/skills.ts' }),
  ],
});
```

Browsers load `billing` from `/mf-manifest.json` as before. Gateways load
`billing@https://<host>/skills/mf-manifest.json`, from the build output or
the dev server.

### With `pluginModuleFederation` alone

Any Node remote built with the official plugin works. Expose the provider
from a Node environment and add a rule for `?raw`:

```ts
// rsbuild.config.ts
import { defineConfig } from '@rsbuild/core';
import { pluginModuleFederation } from '@module-federation/rsbuild-plugin';
import { rawSourceRule } from '@module-federation/mcp/build';

export default defineConfig({
  environments: {
    node: {
      source: { entry: { index: './src/skills.ts' } },
      output: { target: 'node' },
    },
  },
  tools: { rspack: { module: { rules: [rawSourceRule] } } },
  plugins: [
    pluginModuleFederation(
      { name: 'releases', exposes: { './skills': './src/skills.ts' } },
      { target: 'node', environment: 'node' },
    ),
  ],
});
```

With Rsbuild's default asset prefix (`/`), the gateway resolves the remote's
files from the root of the manifest's origin. Set `output.assetPrefix: 'auto'`
in the Node environment to host the remote under a sub-path.

### Rspack or webpack

```js
// rspack.config.js
const { SkillsProviderPlugin } = require('@module-federation/mcp/build');

module.exports = {
  target: 'async-node',
  entry: {},
  output: { publicPath: 'auto' },
  plugins: [
    new SkillsProviderPlugin({
      name: 'releases',
      provider: './src/skills.ts',
      // federation: { shared: { ... } }  // any extra ModuleFederationPlugin options
    }),
  ],
};
```

`SkillsProviderPlugin` needs `@module-federation/enhanced` and
`@module-federation/node` installed in the provider project.

### What the gateway loads

The gateway loads CommonJS Node remotes, which is what all of the above
produce. ES module remotes (`library.type: 'module'`) need Node's
`--experimental-vm-modules` flag; without it the gateway fails with an error
that says so.

For `?raw` import types, add
`"types": ["@module-federation/mcp/raw"]` to your `tsconfig.json`.

## Serve the skills

Loading providers gives you a **catalog**: every skill, file and tool, checked
and merged. Serving the catalog over MCP is up to you. Add it to an MCP server
you already run, or start the ready-made gateway.

| You want to                            | Use                                              |
| -------------------------------------- | ------------------------------------------------ |
| Serve skills without writing code      | [the CLI](#with-the-cli)                         |
| Add skills to your official-SDK server | [`registerSkills()`](#in-your-own-mcp-server)    |
| Add skills to your Effect server       | [`./effect`](#with-effect)                       |
| Start a gateway from code              | [`createSkillsGateway()`](#a-ready-made-gateway) |
| Use another MCP server or framework    | [the catalog API](#any-other-server)             |

Every option serves the same things:

- each skill file as a resource, e.g. `skill://release-checklist/SKILL.md`,
- each tool, with its JSON Schema and the providing remote in `_meta`,
- the SEP-2640 `skills/list` and `skills/get` methods, and the
  `io.modelcontextprotocol/skills` extension capability.

Tool arguments are validated against Standard Schemas. Invalid arguments and
thrown errors come back as `isError` results the model can read. Plain JSON
Schema inputs are advertised to clients but not validated.

### With the CLI

```bash
npx federated-skills \
  --remote releases@https://cdn.example.com/releases/mf-manifest.json \
  --remote billing@https://cdn.example.com/billing/mf-manifest.json \
  --dir ./skills
```

`--remote` takes `name@url` or `name=url`, and the URL can point to
`mf-manifest.json` or `remoteEntry.js`. `--dir` serves standard
`<skill>/SKILL.md` folders from disk. Remotes can also come from
`MF_SKILLS_REMOTES`, and `--config <file>` loads gateway options from a
module's default export.

Register it with any MCP client, for example Codex:

```bash
codex mcp add skills -- npx -y @module-federation/mcp --remote releases@https://cdn.example.com/releases/mf-manifest.json
```

### In your own MCP server

With the official MCP TypeScript SDK (`@modelcontextprotocol/server`), load a
catalog once and register it on your `McpServer`, next to your own tools:

```ts
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { registerSkills } from '@module-federation/mcp/mcp';
import {
  defaultInstructions,
  loadSkillsCatalog,
  skillsDirectory,
} from '@module-federation/mcp/server';

const catalog = await loadSkillsCatalog([
  'releases@https://cdn.example.com/releases/mf-manifest.json',
  {
    name: 'billing',
    entry: 'https://cdn.example.com/billing/mf-manifest.json',
    optional: true,
  },
  skillsDirectory('./skills'),
]);

serveStdio(() => {
  const server = new McpServer(
    { name: 'acme', version: '1.0.0' },
    // Indexes the skills for clients that don't implement skills/list yet.
    { instructions: defaultInstructions(catalog) },
  );
  server.registerTool('deploy', { description: 'Deploy a service.' }, deploy);
  registerSkills(server, catalog);
  return server;
});
```

Call `registerSkills()` before the server connects. Over HTTP, do the same
inside the factory you pass to `createMcpHandler()`. The optional third
argument sets the cache hint, `{ cache: { ttlMs, cacheScope } }`.

### With Effect

`./effect` builds the same thing on Effect's
[`McpServer`](https://effect.website/docs/v4/api/effect/ai/McpServer). It needs
`effect` and `@effect/platform-node`, which this package lists as optional
peer dependencies:

```ts
import { Effect, Layer } from 'effect';
import { McpServer } from 'effect/ai';
import { makeSkillsGateway } from '@module-federation/mcp/effect';

const ServerLayer = Effect.gen(function* () {
  // Fails with FederatedSkillsError when a provider can't be loaded.
  const gateway = yield* makeSkillsGateway({ providers });
  return Layer.mergeAll(gateway.layer, MyToolkitLayer).pipe(
    Layer.provide(
      McpServer.layerHttp({ ...gateway.serverOptions, path: '/mcp' }),
    ),
  );
}).pipe(Layer.unwrap);
```

`gateway.layer` registers the resources and tools. `gateway.serverOptions`
carries the name, version, instructions, extension capability, and the
protocol adapters that add `skills/list` and `skills/get`. To wrap your own
adapters, use `withSkillsExtension(catalog)`. `createGatewayFromCatalog()`
does the same for a catalog you already loaded.

### A ready-made gateway

`createSkillsGateway()` loads the providers and builds a server for you, on
the official SDK. The CLI uses it.

```ts
import { createSkillsGateway } from '@module-federation/mcp/mcp';

const gateway = await createSkillsGateway({
  name: 'acme-skills',
  providers: ['releases@https://cdn.example.com/releases/mf-manifest.json'],
});

await gateway.serveStdio();
```

- `gateway.serveStdio()` serves over stdio until the client closes stdin.
- `gateway.toWebHandler()` returns a fetch-style
  `(Request) => Promise<Response>` Streamable HTTP handler for Node, Bun,
  Deno, Workers, Hono and anything else that speaks `Request`/`Response`.
  Pass `{ allowedOriginHostnames }` to reject browser requests from other
  origins.
- `gateway.createServer()` returns a new `McpServer` for any other transport.
- `gateway.catalog` is everything that was loaded.

`./effect` exports a `createSkillsGateway()` with the same options plus
`protocols`, whose gateway also has Effect layers (`layer`, `layerStdio()`,
`layerHttp()`).

| Option         | Default                                   | Description                                                                                   |
| -------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| `providers`    | required                                  | Remotes (`'name@url'` or `{ name, entry, expose?, optional? }`), provider objects, or loaders |
| `name`         | `'module-federation-skills'`              | MCP server name                                                                               |
| `version`      | package version                           | MCP server version                                                                            |
| `instructions` | skill index                               | Server instructions; `false` omits them, a function receives the catalog                      |
| `cache`        | `{ ttlMs: 300000, cacheScope: 'public' }` | Cache hint for `skills/list`, `skills/get` and skill files                                    |
| `federation`   | new runtime instance                      | A Module Federation runtime instance, or options such as runtime `plugins`                    |
| `logger`       | `console`                                 | Receives warnings about skipped `optional` providers                                          |

### Any other server

`loadSkillsCatalog()` from `./server` depends on neither MCP SDK. Map the
catalog onto any server's handlers:

| MCP method       | Catalog                                            |
| ---------------- | -------------------------------------------------- |
| `tools/list`     | `catalog.listTools()`                              |
| `tools/call`     | `catalog.callTool(name, args, { signal, client })` |
| `resources/list` | `catalog.resources`                                |
| `resources/read` | `catalog.readResource(uri)`                        |
| `skills/list`    | `catalog.skills`                                   |
| `skills/get`     | `catalog.getSkill(uri)`                            |

`callTool` validates the arguments, runs the handler and returns a tool
result, so it only throws for an unknown tool name. Add `ttlMs` and
`cacheScope` to `skills/list` and `skills/get` results; the wire schemas are in
[`./protocol`](#consume-skills-from-a-client).

### What the gateway checks

- Duplicate skill URIs and tool names across providers fail at startup and
  name both providers.
- Every skill file gets a SHA-256 digest and byte size, as SEP-2640 requires.
- Remotes that fail to load produce an error naming the provider and URL.
  Mark a remote `optional` to log the failure and skip it.

## Consume skills from a client

`@module-federation/mcp/protocol` exports the SEP-2640 wire
schemas as zod schemas, which are Standard Schemas any client can use, such as
the official MCP SDK:

```ts
import { ListSkillsResultSchema } from '@module-federation/mcp/protocol';

const { skills } = await client.request(
  { method: 'skills/list', params: {} },
  ListSkillsResultSchema,
);
```

## Trust model

Providers run JavaScript inside the gateway process. Only load remotes you
trust, from URLs you control. Pin them to immutable build URLs when you can.
