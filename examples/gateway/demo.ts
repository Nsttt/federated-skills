import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import {
  GetSkillResultSchema,
  ListSkillsResultSchema,
} from '@module-federation/federated-skills/protocol';

// Plays an agent working through the gateway the way Claude Code or Codex
// would, and prints what it sees.

const heading = (text: string) => console.log(`\n── ${text} ──`);
const indent = (text: string) => text.replace(/^/gm, '  ');

const client = new Client(
  { name: 'example-demo', version: '1.0.0' },
  { versionNegotiation: { mode: 'auto' } },
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(import.meta.dirname, 'gateway.ts')],
  stderr: 'pipe',
});
// The gateway logs its summary and an audit line per tool call on stderr.
const gatewayLog: string[] = [];
transport.stderr?.on('data', (chunk: Buffer) => {
  gatewayLog.push(...chunk.toString().split('\n').filter(Boolean));
});
await client.connect(transport);

const call = async (name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({ name, arguments: args });
  const [content] = result.content as { type: string; text?: string }[];
  console.log(
    `\n${name}(${JSON.stringify(args)})${result.isError ? ' → error' : ''}`,
  );
  console.log(indent(content?.text ?? ''));
  return result.structuredContent as Record<string, unknown> | undefined;
};

try {
  heading('1. Skills from every team, in one list (skills/list)');
  const { skills } = await client.request(
    { method: 'skills/list', params: {} },
    ListSkillsResultSchema,
  );
  for (const skill of skills) {
    const owner = skill.frontmatter.metadata?.owner ?? '?';
    console.log(`  ${skill.uri.padEnd(50)} owner: ${owner}`);
  }

  heading("2. Who owns what (the gateway's own tool)");
  const { teams } = (await client.callTool({ name: 'list_teams' }))
    .structuredContent as {
    teams: { team: string; contact: string; status: string; tools: string[] }[];
  };
  for (const team of teams) {
    console.log(
      `  ${team.team.padEnd(20)} ${team.contact.padEnd(15)} ${team.status.padEnd(12)} tools: ${team.tools.join(', ') || '-'}`,
    );
  }

  heading('3. Read a skill and its files (skills/get, resources/read)');
  const uri = 'skill://acme/support/refund-request/SKILL.md';
  const { skill } = await client.request(
    { method: 'skills/get', params: { uri } },
    GetSkillResultSchema,
  );
  for (const file of skill.resources) {
    console.log(
      `  ${file.uri}  ${file.size} bytes  ${file.digest.slice(0, 19)}…`,
    );
  }
  const { contents } = await client.readResource({ uri });
  const [content] = contents;
  console.log(
    `\n${indent(content && 'text' in content ? content.text.trim() : '')}`,
  );

  heading('4. Tools, with the team that ships them and their hints');
  const { tools } = await client.listTools();
  for (const tool of tools) {
    const provider = tool._meta?.['io.github.module-federation/provider'];
    const hint = tool.annotations?.destructiveHint
      ? 'destructive'
      : tool.annotations?.readOnlyHint
        ? 'read-only'
        : '';
    console.log(
      `  ${tool.name.padEnd(16)} ${(typeof provider === 'string' ? provider : 'gateway').padEnd(9)} ${hint}`,
    );
  }

  heading("5. Follow refund-request across two teams' tools");
  const customer = await call('lookup_customer', {
    email: 'ops@globex.example',
  });
  const quote = await call('quote_price', {
    plan: customer?.plan,
    seats: customer?.seats,
    billing: customer?.billing,
  });
  const invoice = customer?.lastInvoice as { total: number };
  const overcharge = invoice.total - Number(quote?.total);
  console.log(
    `\n  Invoice $${invoice.total} - quote $${String(quote?.total)} = $${overcharge} overcharged`,
  );
  await call('issue_refund', {
    customerId: customer?.id,
    amount: overcharge,
    reason: 'Billed for 9 seats instead of 8',
  });

  heading('6. Invalid calls come back as errors the model can fix');
  await call('issue_refund', {
    customerId: customer?.id,
    amount: invoice.total,
    reason: 'Customer wants a full refund',
  });
} finally {
  await client.close();
}

heading('7. Gateway log (stderr)');
for (const line of gatewayLog) {
  if (line.startsWith('{') || line.startsWith('[acme-skills]')) {
    console.log(indent(line));
  }
}
