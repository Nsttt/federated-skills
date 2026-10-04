# @module-federation/skills-mcp

Ship [agent skills](https://agentskills.io) and tools from Module Federation
remotes, and serve them all through one MCP server.

Each team publishes a **skills provider**: a federated remote that bundles
`SKILL.md` files, supporting files, and the JavaScript tools those skills
describe. A **gateway** loads the providers at startup and exposes them over
the Model Context Protocol, including the Skills extension (SEP-2640). MCP
clients see ordinary skills, resources and tools. They don't need to know
Module Federation is involved.

```bash
pnpm add @module-federation/skills-mcp
```

## Write a provider

```ts
// src/skills.ts
import {
  defineSkill,
  defineSkillsProvider,
  defineTool,
} from '@module-federation/skills-mcp';
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

`SkillsProviderPlugin` works with rspack and webpack. It configures a
Node-loadable remote with a manifest and exposes your provider as `./skills`.
It also makes `?raw` imports return file contents as strings.

```js
// rspack.config.js
const { SkillsProviderPlugin } = require('@module-federation/skills-mcp/build');

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

The plugin needs `@module-federation/enhanced` and `@module-federation/node`
installed in the provider project. For `?raw` import types, add
`"types": ["@module-federation/skills-mcp/raw"]` to your `tsconfig.json`.

Deploy the build output anywhere that serves static files.

## Run a gateway

### With the CLI

```bash
npx mf-skills-mcp \
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
codex mcp add skills -- npx -y -p @module-federation/skills-mcp mf-skills-mcp --remote releases@https://cdn.example.com/releases/mf-manifest.json
```

### In code

```ts
import {
  createSkillsGateway,
  skillsDirectory,
} from '@module-federation/skills-mcp/server';

const gateway = await createSkillsGateway({
  name: 'acme-skills',
  providers: [
    'releases@https://cdn.example.com/releases/mf-manifest.json',
    {
      name: 'billing',
      entry: 'https://cdn.example.com/billing/mf-manifest.json',
      optional: true,
    },
    skillsDirectory('./skills'),
    localProvider, // a defineSkillsProvider() result, in-process
  ],
});

gateway.serveStdio();
```

The gateway is transport-agnostic:

- `gateway.createServer()` returns a fresh `McpServer` for any transport, such
  as streamable HTTP through `createMcpHandler`.
- `gateway.register(server)` adds the skills, resources and tools to a server
  you already have.
- `gateway.catalog` exposes everything that was loaded, with digests and sizes.

| Option         | Default                                   | Description                                                                                   |
| -------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| `providers`    | required                                  | Remotes (`'name@url'` or `{ name, entry, expose?, optional? }`), provider objects, or loaders |
| `name`         | `'module-federation-skills'`              | MCP server name                                                                               |
| `version`      | package version                           | MCP server version                                                                            |
| `instructions` | skill index                               | Server instructions; `false` omits them, a function receives the catalog                      |
| `cache`        | `{ ttlMs: 300000, cacheScope: 'public' }` | Cache hint for skills and resources                                                           |
| `federation`   | new runtime instance                      | A Module Federation runtime instance, or options such as runtime `plugins`                    |
| `logger`       | `console`                                 | Receives warnings about skipped `optional` providers                                          |

By default the gateway sends a short index of its skills as server
instructions. Agents can then find skills even in clients that don't
implement `skills/list` yet.

### What the gateway checks

- Duplicate skill URIs and tool names across providers fail at startup and
  name both providers.
- Every skill file gets a SHA-256 digest and byte size, as SEP-2640 requires.
- Remotes that fail to load produce an error naming the provider and URL.
  Mark a remote `optional` to log the failure and skip it.

## Consume skills from a client

`@module-federation/skills-mcp/protocol` exports the SEP-2640 wire schemas:

```ts
import { ListSkillsResultSchema } from '@module-federation/skills-mcp/protocol';

const { skills } = await client.request(
  { method: 'skills/list', params: {} },
  ListSkillsResultSchema,
);
```

## Trust model

Providers run JavaScript inside the gateway process. Only load remotes you
trust, from URLs you control. Pin them to immutable build URLs when you can.
