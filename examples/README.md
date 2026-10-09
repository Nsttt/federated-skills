# Examples: Acme's skills platform

Acme has several product teams. Each one knows its own domain and owns the
tools for it. The platform team runs one MCP gateway that every engineer's
agent connects to, and each team ships its skills to it from its own repo, on
its own release schedule, with whatever bundler it already uses.

| Team                | Folder                   | Builds with               | Ships                                                            |
| ------------------- | ------------------------ | ------------------------- | ---------------------------------------------------------------- |
| Release Engineering | [`releases`](./releases) | Rsbuild, skills only      | Release checklist and rollback skills, release tools             |
| Billing             | [`billing`](./billing)   | Rsbuild, next to its app  | A pricing skill and `quote_price`, on the checkout's own code    |
| Support Tools       | [`support`](./support)   | Rspack                    | A refund skill that uses Billing's tool, and a destructive tool  |
| Platform            | [`gateway`](./gateway)   | Nothing; runs the gateway | The registry, its own skills and tool, audit log, CI check, demo |

Two more folders show the repo shapes teams ship to the Zephyr MCP with
`ze-cli`, without Module Federation:

| Folder                         | Builds with                    | Ships                                                              |
| ------------------------------ | ------------------------------ | ------------------------------------------------------------------ |
| [`skills-repo`](./skills-repo) | Nothing; no `package.json`     | Two skills and evals, deployed by `npx zephyr-cli@latest deploy .` |
| [`tools-repo`](./tools-repo)   | Rslib with `defineMcpConfig()` | A skill and `quote_price`, deployed from `dist/`                   |

## What each example shows

| Feature                                                                           | Where                                                                                                          |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| A project that only ships skills                                                  | [`releases/rsbuild.config.ts`](./releases/rsbuild.config.ts)                                                   |
| Skills next to an existing web remote, with a tool that reuses the product's code | [`billing/rsbuild.config.ts`](./billing/rsbuild.config.ts), [`billing/src/skills.ts`](./billing/src/skills.ts) |
| Rspack (or webpack) instead of Rsbuild                                            | [`support/rspack.config.ts`](./support/rspack.config.ts)                                                       |
| `SKILL.md` files with supporting files, served byte for byte with digests         | `releases/src/release-checklist/`, `support/src/refund-request/`                                               |
| Plain `SKILL.md` folders with no build step                                       | [`gateway/skills/`](./gateway/skills)                                                                          |
| Namespaces, so two teams can both ship a `rollback` skill                         | every skill lives under `skill://acme/<team>/`                                                                 |
| Owner, contact and allowed tools in the frontmatter                               | every `SKILL.md`                                                                                               |
| Skills that use another team's tools                                              | `refund-request` calls Billing's `quote_price`; `incident-response` calls Release Engineering's tools          |
| Arguments validated with zod, and errors the model can read and fix               | `issue_refund` in [`support/src/skills.ts`](./support/src/skills.ts)                                           |
| Read-only and destructive hints for clients                                       | `annotations` on every tool                                                                                    |
| A tool that records which client called it                                        | `issue_refund`'s `requestedBy`                                                                                 |
| The gateway's own tool next to the teams' tools                                   | `list_teams` in [`gateway/server.ts`](./gateway/server.ts)                                                     |
| An audit log line for every tool call                                             | [`gateway/audit.ts`](./gateway/audit.ts)                                                                       |
| A team registry with dev and prod URLs                                            | [`gateway/registry.ts`](./gateway/registry.ts)                                                                 |
| One team's outage doesn't take the gateway down                                   | [`gateway/catalog.ts`](./gateway/catalog.ts)                                                                   |
| A CI check: every provider loads, no name clashes, every skill has an owner       | [`gateway/check.ts`](./gateway/check.ts)                                                                       |
| stdio for one engineer, HTTP for the whole company                                | [`gateway/gateway.ts`](./gateway/gateway.ts)                                                                   |

## Run them

From the repository root, install and build the package the examples link to:

```bash
pnpm install
pnpm build
```

Start every team's dev server (releases on 3001, billing on 3002, support on
3003):

```bash
pnpm --filter "./examples/*" --parallel dev
```

In another terminal, run the demo. It starts the gateway over stdio and works
through it like an agent would:

```bash
pnpm --filter example-gateway demo
```

```text
── 1. Skills from every team, in one list (skills/list) ──
  skill://acme/releases/release-checklist/SKILL.md   owner: release-engineering
  skill://acme/releases/rollback/SKILL.md            owner: release-engineering
  skill://acme/billing/pricing-questions/SKILL.md    owner: billing
  skill://acme/support/refund-request/SKILL.md       owner: support-tools
  skill://acme/platform/incident-response/SKILL.md   owner: platform
  skill://acme/platform/on-call/SKILL.md             owner: platform

── 2. Who owns what (the gateway's own tool) ──
  Release Engineering  #release-eng    available    tools: list_releases, lookup_release
  Billing              #billing-eng    available    tools: quote_price
  Support Tools        #support-tools  available    tools: lookup_customer, issue_refund
  Platform             #platform       available    tools: -
...
── 5. Follow refund-request across two teams' tools ──
...
  Invoice $1080 - quote $960 = $120 overcharged

issue_refund({"customerId":"cus_1042","amount":120,"reason":"Billed for 9 seats instead of 8"})
  {
    "refundId": "re_1001",
    ...
    "requestedBy": "example-demo"
  }

── 6. Invalid calls come back as errors the model can fix ──

issue_refund({"customerId":"cus_1042","amount":1080,"reason":"Customer wants a full refund"}) → error
  Invalid arguments for tool "issue_refund": approvedBy: refunds over $500 need the name of the support manager who approved them

── 7. Gateway log (stderr) ──
  [acme-skills] dev: 6 skills and 5 tools from releases, billing, support, platform
  {"audit":"tools/call","at":"…","tool":"lookup_customer","provider":"support","client":"example-demo","ok":true,"ms":1}
  ...
```

### Break something

- Stop the support dev server and run the demo again. The gateway logs that
  it skipped `support`, `list_teams` reports it `unavailable`, and everything
  else keeps working.
- Run the CI check: `pnpm --filter example-gateway check`. It passes while
  every dev server is up, and fails when one is down, when two teams ship a
  skill or tool with the same name, or when a skill has no `owner` and
  `contact` in its frontmatter.

## Connect your agent

Run the gateway next to your agent, over stdio:

```bash
claude mcp add acme-skills -- node "$PWD/examples/gateway/gateway.ts"
codex mcp add acme-skills -- node "$PWD/examples/gateway/gateway.ts"
```

Or run one gateway for everyone, over Streamable HTTP, and add its URL:

```bash
pnpm --filter example-gateway start:http   # http://localhost:3000/mcp
claude mcp add --transport http acme-skills http://localhost:3000/mcp
```

The package's CLI serves the same skills without any code. It has no
`list_teams` or audit log, and `--dir` can't add a namespace, so the platform
skills show up as `skill://on-call/...`. From the repository root:

```bash
node bin/federated-skills.js \
  --remote releases@http://localhost:3001/mf-manifest.json \
  --remote billing@http://localhost:3002/skills/mf-manifest.json \
  --remote support@http://localhost:3003/mf-manifest.json \
  --dir examples/gateway/skills
```

## Deploy

Each team builds and uploads its own `dist/` to the prod URL in
[`gateway/registry.ts`](./gateway/registry.ts):

```bash
pnpm --filter example-releases build   # releases/dist/
pnpm --filter example-billing build    # billing/dist/ (web app), billing/dist/skills/ (provider)
pnpm --filter example-support build    # support/dist/
```

The platform team runs the gateway against the prod URLs:

```bash
SKILLS_ENV=prod pnpm --filter example-gateway check
SKILLS_ENV=prod PORT=3000 pnpm --filter example-gateway start:http
```

Some things to know:

- The gateway loads providers when it starts. Restart or redeploy it to pick
  up a team's new build.
- The gateway runs every team's tools in its own process. Only register
  providers from URLs your teams control.
- Over HTTP, only browser pages on localhost may call the gateway. Put your
  SSO proxy in front of it for a real deployment.
- Clients on MCP revisions before 2026-07-28 that connect over HTTP show up
  as `unknown` in the audit log: the SDK serves them without a session.
- `gateway/*.ts` runs as TypeScript directly, which needs Node 22.18 or
  later.
