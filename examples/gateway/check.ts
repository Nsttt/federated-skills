import { unavailable, loadCatalog } from './catalog.ts';
import { summary } from './server.ts';

// Run in CI before deploying the gateway. Fails when a registered provider
// doesn't load, when two teams ship the same skill or tool name, or when a
// skill breaks the platform's conventions.
const problems: string[] = [];

const catalog = await loadCatalog({ strict: true }).catch((error: Error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});

for (const provider of unavailable(catalog)) {
  problems.push(`provider "${provider.name}" did not load`);
}
for (const skill of catalog.skills) {
  const { owner, contact } = skill.frontmatter.metadata ?? {};
  if (!owner || !contact) {
    problems.push(
      `${skill.uri} needs metadata.owner and metadata.contact in its frontmatter`,
    );
  }
}
for (const { tool, provider } of catalog.tools) {
  const { readOnlyHint, destructiveHint } = tool.annotations ?? {};
  if (readOnlyHint === undefined && destructiveHint === undefined) {
    problems.push(
      `tool "${tool.name}" (${provider.name}) must say whether it is read-only or destructive`,
    );
  }
}

for (const problem of problems) console.error(`✗ ${problem}`);
if (problems.length > 0) process.exit(1);
console.error(`✓ ${summary(catalog)}`);
