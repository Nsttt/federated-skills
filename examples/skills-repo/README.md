# A skills-only repo

The smallest thing a team can ship to the Zephyr MCP: folders of Agent Skills,
no `package.json` and no build.

```
skills/<skill-name>/SKILL.md      # the skill; name equals the folder name
skills/<skill-name>/references/   # served next to SKILL.md (also assets/, scripts/)
skills/<skill-name>/evals/        # skill-creator evals; never uploaded or served
```

Every `SKILL.md` needs `metadata.owner` and `metadata.contact`, so people know
who to ask about it.

Check the repo locally, then deploy (CI does the same with
[`.github/workflows/zephyr.yml`](./.github/workflows/zephyr.yml)):

```bash
npx zephyr-cli@latest doctor .
npx zephyr-cli@latest deploy .
```

Release the version in Zephyr and every engineer's agent gets these skills
through the Zephyr MCP.
