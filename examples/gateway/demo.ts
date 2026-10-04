import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { ListSkillsResultSchema } from '@module-federation/federated-skills/protocol';

const indent = (text: string) => text.replace(/^/gm, '  ');

// Starts gateway.ts the way an MCP client would and walks through it.
const client = new Client(
  { name: 'example-demo', version: '1.0.0' },
  { versionNegotiation: { mode: 'auto' } },
);
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [path.join(import.meta.dirname, 'gateway.ts')],
    stderr: 'inherit',
  }),
);

try {
  const { skills } = await client.request(
    { method: 'skills/list', params: {} },
    ListSkillsResultSchema,
  );
  console.log('\nskills/list');
  for (const skill of skills) console.log(`  ${skill.uri}`);

  const first = skills[0];
  if (first) {
    const { contents } = await client.readResource({ uri: first.uri });
    const text = 'text' in contents[0]! ? contents[0].text : '';
    console.log(`\n${first.uri}\n${indent(text.trim())}`);
  }

  const { tools } = await client.listTools();
  console.log('\ntools/list');
  for (const tool of tools) console.log(`  ${tool.name}: ${tool.description}`);

  const calls = [
    { name: 'list_releases', arguments: { status: 'live' } },
    {
      name: 'quote_price',
      arguments: { plan: 'team', seats: 8, billing: 'yearly' },
    },
  ];
  for (const call of calls) {
    if (!tools.some((tool) => tool.name === call.name)) continue;
    const result = await client.callTool(call);
    const [content] = result.content as { type: string; text?: string }[];
    console.log(
      `\n${call.name}(${JSON.stringify(call.arguments)})\n${indent(content?.text ?? '')}`,
    );
  }
} finally {
  await client.close();
}
