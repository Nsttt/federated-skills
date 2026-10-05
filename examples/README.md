# Examples

Two teams ship skills from their own Rsbuild projects, and one gateway serves
them all to MCP clients.

| Folder                   | What it shows                                                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [`releases`](./releases) | A project that only ships skills. A `SKILL.md` with a reference file, an inline skill, and two tools. Builds to `dist/`.                  |
| [`billing`](./billing)   | An app that is already a web remote (`pluginModuleFederation`) and also ships skills. Its tool runs the same pricing code as the UI.      |
| [`gateway`](./gateway)   | An MCP server of its own, with one tool, that adds both remotes plus a local `skills/` folder with `registerSkills()`. And a demo client. |

## Run them

From the repository root, install and build the package the examples link to:

```bash
pnpm install
pnpm build
```

Start both providers' dev servers, each in its own terminal:

```bash
pnpm --filter example-releases dev   # http://localhost:3001/mf-manifest.json
pnpm --filter example-billing dev    # http://localhost:3002/ (web remote)
                                     # http://localhost:3002/skills/mf-manifest.json
```

Then run the demo client. It starts `gateway/gateway.ts` over stdio, lists the
skills, reads one, and calls the gateway's own tool and one from each provider:

```bash
pnpm --filter example-gateway demo
```

```text
skills/list
  skill://release-checklist/SKILL.md
  skill://rollback/SKILL.md
  skill://acme/billing/pricing-questions/SKILL.md
  skill://on-call/SKILL.md
...
quote_price({"plan":"team","seats":8,"billing":"yearly"})
  {
    "plan": "team",
    "seats": 8,
    "billing": "yearly",
    "total": 960,
    "currency": "USD"
  }
```

The gateway marks both remotes `optional`, so it still starts when one dev
server is down and logs which provider it skipped. Restart it to pick up
changes to a provider.

## Use it from an MCP client

Register the gateway with any MCP client that runs stdio servers, for example
Claude Code or Codex:

```bash
claude mcp add acme-skills -- node "$PWD/examples/gateway/gateway.ts"
codex mcp add acme-skills -- node "$PWD/examples/gateway/gateway.ts"
```

The package's CLI serves the same skills without any code, just without the
`list_providers` tool. From the repository root:

```bash
node bin/federated-skills.js \
  --remote releases@http://localhost:3001/mf-manifest.json \
  --remote billing@http://localhost:3002/skills/mf-manifest.json \
  --dir examples/gateway/skills
```

## Deploy

`pnpm --filter example-releases build` writes the remote to
`releases/dist/`, and `pnpm --filter example-billing build` writes the web
remote to `billing/dist/` with the provider in `billing/dist/skills/`. Upload
them to any static host, or try them locally with `rsbuild preview` (the
`preview` script). Point the gateway at deployed builds with `SKILLS_REMOTES`:

```bash
SKILLS_REMOTES="releases@https://cdn.example.com/releases/mf-manifest.json billing@https://cdn.example.com/billing/skills/mf-manifest.json" \
  node examples/gateway/gateway.ts
```

`gateway.ts` runs as TypeScript directly, which needs Node 22.18 or later.
