# A tools repo

Skills plus tools that run in a Worker Loader isolate behind the Zephyr MCP.

```
skills/<skill-name>/SKILL.md   # skills, as in a skills-only repo
tools/<tool_name>.ts           # one tool per file; the file name is the tool name
tools/lib/                     # shared code; subfolders are never tools
rslib.config.ts                # export default defineMcpConfig()
```

Build and deploy (CI does the same with
[`.github/workflows/zephyr.yml`](./.github/workflows/zephyr.yml)):

```bash
pnpm build                          # writes dist/: tools/index.js, catalog.json, mcp-provider.json, skills/
npx zephyr-cli@latest deploy dist
```

To start your own repo from this one, replace `"workspace:*"` in
`package.json` with a published range (for example `"^0.1.0"`), run
`pnpm install` and commit `pnpm-lock.yaml`: the workflow installs with
`--frozen-lockfile`. Here the dependency points at this monorepo's package.

Every tool says whether it is read-only or destructive (`annotations`), never
keeps per-caller state in module globals (one isolate serves every caller of a
version), and cannot import `node:*` or `cloudflare:*` modules.
