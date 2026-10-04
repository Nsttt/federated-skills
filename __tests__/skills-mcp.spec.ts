import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterAll, describe, expect, it } from '@rstest/core';
import * as z from 'zod/v4';
import {
  defineSkill,
  defineSkillsProvider,
  defineTool,
  parseSkillMarkdown,
} from '../src';
import {
  GetSkillResultSchema,
  ListSkillsResultSchema,
  SKILLS_EXTENSION,
} from '../src/protocol';
import {
  createSkillsCatalog,
  createSkillsGateway,
  parseRemoteSource,
  skillsDirectory,
  type SkillsGatewayOptions,
} from '../src/server';

const releaseSkill = defineSkill({
  name: 'release-checklist',
  description: 'Use before publishing a new version of a package.',
  license: 'MIT',
  allowedTools: ['lookup_order', 'add'],
  namespace: 'acme/release',
  instructions: '# Release\n\n1. Read references/gates.md',
  files: { 'references/gates.md': '# Gates\n\n- green CI\n' },
});

const addTool = defineTool({
  name: 'add',
  description: 'Add two numbers.',
  inputSchema: z.object({ a: z.number(), b: z.number() }),
  handler: ({ a, b }) => ({ sum: a + b }),
});

const echoTool = defineTool({
  name: 'echo',
  description: 'Echo a message.',
  inputSchema: {
    type: 'object',
    properties: { message: { type: 'string' } },
    required: ['message'],
  },
  handler: ({ message }, { provider }) => `${provider.name}: ${message}`,
});

const pingTool = defineTool({
  name: 'ping',
  description: 'No input at all.',
  handler: () => undefined,
});

const provider = defineSkillsProvider({
  name: 'acme',
  version: '1.2.3',
  skills: [releaseSkill],
  tools: [addTool, echoTool, pingTool],
});

const connect = async (options: Partial<SkillsGatewayOptions> = {}) => {
  const gateway = await createSkillsGateway({
    providers: [provider],
    ...options,
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await gateway.createServer().connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  return { client, gateway };
};

const textOf = (result: { content: Array<{ type: string; text?: string }> }) =>
  result.content.find((block) => block.type === 'text')?.text;

describe('defineSkill', () => {
  it('generates a SKILL.md with frontmatter', () => {
    const skillMd = releaseSkill.files['SKILL.md'];
    expect(releaseSkill.path).toBe('acme/release/release-checklist');
    expect(skillMd && 'text' in skillMd).toBe(true);
    const { frontmatter, body } = parseSkillMarkdown(
      (skillMd as { text: string }).text,
    );
    expect(frontmatter).toEqual({
      name: 'release-checklist',
      description: 'Use before publishing a new version of a package.',
      license: 'MIT',
      'allowed-tools': 'lookup_order add',
    });
    expect(body.trim()).toBe('# Release\n\n1. Read references/gates.md');
    expect(releaseSkill.files['references/gates.md']).toEqual({
      mimeType: 'text/markdown',
      text: '# Gates\n\n- green CI\n',
    });
  });

  it('serves an existing SKILL.md byte-for-byte', () => {
    const markdown =
      '---\nname: from-disk\ndescription: >\n  Folded\n  description.\nmetadata:\n  owner: team-a\n---\nBody\n';
    const skill = defineSkill({ markdown });
    expect(skill.path).toBe('from-disk');
    expect(skill.frontmatter).toEqual({
      name: 'from-disk',
      description: 'Folded description.\n',
      metadata: { owner: 'team-a' },
    });
    expect(skill.files['SKILL.md']).toEqual({
      mimeType: 'text/markdown',
      text: markdown,
    });
  });

  it('rejects invalid definitions with actionable errors', () => {
    expect(() =>
      defineSkill({ name: 'Bad Name', description: 'x', instructions: '' }),
    ).toThrow(/lowercase letters/);
    expect(() =>
      defineSkill({ name: 'ok', description: '', instructions: '' }),
    ).toThrow(/missing a "description"/);
    expect(() =>
      defineSkill({
        name: 'ok',
        description: 'x',
        instructions: '',
        files: { '../escape.md': 'nope' },
      }),
    ).toThrow(/invalid file path/);
    expect(() => defineSkill({ markdown: 'no frontmatter' })).toThrow(
      /frontmatter/,
    );
  });
});

describe('createSkillsCatalog', () => {
  const resolved = { ...provider, name: 'acme', source: 'local' };

  it('rejects duplicate skills and tools across providers', () => {
    expect(() =>
      createSkillsCatalog([
        resolved,
        { ...resolved, name: 'other', tools: [] },
      ]),
    ).toThrow(/provided by both "acme" and "other"/);
    expect(() =>
      createSkillsCatalog([
        resolved,
        { ...resolved, name: 'other', skills: [] },
      ]),
    ).toThrow(/Tool "add" is provided by both/);
  });

  it('computes SEP-2640 digests over the served bytes', () => {
    const catalog = createSkillsCatalog([resolved]);
    const [skill] = catalog.skills;
    expect(skill?.uri).toBe('skill://acme/release/release-checklist/SKILL.md');
    expect(skill?.resources.map((resource) => resource.uri)).toEqual([
      'skill://acme/release/release-checklist/SKILL.md',
      'skill://acme/release/release-checklist/references/gates.md',
    ]);
    const gates = catalog.getResource(
      'skill://acme/release/release-checklist/references/gates.md',
    );
    expect(gates?.digest).toBe(
      `sha256:${createHash('sha256').update('# Gates\n\n- green CI\n').digest('hex')}`,
    );
    expect(gates?.size).toBe(Buffer.byteLength('# Gates\n\n- green CI\n'));
  });
});

describe('parseRemoteSource', () => {
  it('parses name@url', () => {
    expect(
      parseRemoteSource('billing@https://u:p@cdn.test/mf-manifest.json'),
    ).toEqual({
      name: 'billing',
      entry: 'https://u:p@cdn.test/mf-manifest.json',
    });
    expect(() =>
      parseRemoteSource('https://cdn.test/mf-manifest.json'),
    ).toThrow(/expected "<name>@<url>"/);
  });
});

describe('createSkillsGateway', () => {
  it('serves skills, resources and tools over MCP', async () => {
    const { client } = await connect();
    try {
      expect(
        client.getServerCapabilities()?.extensions?.[SKILLS_EXTENSION],
      ).toEqual({
        directoryRead: false,
      });
      expect(client.getInstructions()).toContain(
        'release-checklist: Use before publishing',
      );

      const list = await client.request(
        { method: 'skills/list', params: {} },
        ListSkillsResultSchema,
      );
      expect(list.skills.map((skill) => skill.frontmatter.name)).toEqual([
        'release-checklist',
      ]);
      expect(list.ttlMs).toBe(300_000);

      const uri = list.skills[0]?.uri ?? '';
      const get = await client.request(
        { method: 'skills/get', params: { uri } },
        GetSkillResultSchema,
      );
      expect(get.skill).toEqual(list.skills[0]);

      const read = await client.readResource({ uri });
      const text = read.contents.find((item) => 'text' in item)?.text ?? '';
      expect(`sha256:${createHash('sha256').update(text).digest('hex')}`).toBe(
        get.skill.resources[0]?.digest,
      );

      const resources = await client.listResources();
      expect(resources.resources).toHaveLength(2);

      const tools = await client.listTools();
      const addListing = tools.tools.find((tool) => tool.name === 'add');
      expect(addListing?.inputSchema.properties).toHaveProperty('a');
      expect(addListing?._meta?.['io.github.module-federation/provider']).toBe(
        'acme',
      );

      const sum = await client.callTool({
        name: 'add',
        arguments: { a: 2, b: 3 },
      });
      expect(sum.structuredContent).toEqual({ sum: 5 });

      const echo = await client.callTool({
        name: 'echo',
        arguments: { message: 'hi' },
      });
      expect(textOf(echo as never)).toBe('acme: hi');

      const ping = await client.callTool({ name: 'ping' });
      expect(ping.content).toEqual([]);

      const invalid = await client.callTool({
        name: 'add',
        arguments: { a: 'x' },
      });
      expect(invalid.isError).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('lets users override server metadata and instructions', async () => {
    const { client } = await connect({
      name: 'acme-skills',
      version: '9.9.9',
      instructions: false,
      cache: { ttlMs: 1000, cacheScope: 'private' },
    });
    try {
      expect(client.getServerVersion()).toMatchObject({
        name: 'acme-skills',
        version: '9.9.9',
      });
      expect(client.getInstructions()).toBeUndefined();
      const list = await client.request(
        { method: 'skills/list', params: {} },
        ListSkillsResultSchema,
      );
      expect(list).toMatchObject({ ttlMs: 1000, cacheScope: 'private' });
    } finally {
      await client.close();
    }
  });

  it('reports a clear error for providers that do not load', async () => {
    await expect(
      createSkillsGateway({
        providers: [
          { name: 'missing', entry: 'http://127.0.0.1:9/mf-manifest.json' },
        ],
      }),
    ).rejects.toThrow(/Failed to load skills provider "missing"/);

    const warnings: string[] = [];
    const gateway = await createSkillsGateway({
      providers: [
        provider,
        {
          name: 'missing',
          entry: 'http://127.0.0.1:9/mf-manifest.json',
          optional: true,
        },
      ],
      logger: { warn: (message: string) => warnings.push(message) },
    });
    expect(gateway.catalog.providers.map((loaded) => loaded.name)).toEqual([
      'acme',
    ]);
    expect(warnings[0]).toMatch(/"missing"[\s\S]*\(skipped\)$/);
  });
});

describe('skillsDirectory', () => {
  let root = '';

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('loads Agent Skills folders from disk', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'skills-mcp-'));
    const skillDir = path.join(root, 'pdf-tools');
    await mkdir(path.join(skillDir, 'scripts'), { recursive: true });
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: pdf-tools\ndescription: Work with PDF files.\n---\n# PDF\n',
    );
    await writeFile(path.join(skillDir, 'scripts', 'extract.py'), 'print(1)\n');
    await writeFile(path.join(skillDir, 'logo.png'), Buffer.from([0x89, 0x50]));
    await writeFile(path.join(skillDir, '.hidden'), 'ignored');

    const loaded = await skillsDirectory(root, { namespace: 'local' })();
    expect(loaded.name).toBe(path.basename(root));
    const [skill] = loaded.skills;
    expect(skill?.path).toBe('local/pdf-tools');
    expect(Object.keys(skill?.files ?? {}).sort()).toEqual([
      'SKILL.md',
      'logo.png',
      'scripts/extract.py',
    ]);
    expect(skill?.files['scripts/extract.py']).toEqual({
      mimeType: 'text/x-python',
      text: 'print(1)\n',
    });
    expect(skill?.files['logo.png']).toMatchObject({ mimeType: 'image/png' });

    const gateway = await createSkillsGateway({
      providers: [skillsDirectory(root)],
    });
    const logo = gateway.catalog.resources.find((resource) =>
      resource.uri.endsWith('logo.png'),
    );
    expect(logo?.size).toBe(2);
  });
});
