import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
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
import * as effect from '../src/effect';
import * as sdk from '../src/server';
import {
  createSkillsCatalog,
  defaultInstructions,
  loadSkillsCatalog,
  parseRemoteSource,
  skillsDirectory,
  type SkillsGatewayOptions,
} from '../src/catalog';

const { createSkillsGateway } = sdk;

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
  handler: ({ message }, { provider }) =>
    `${provider.name}: ${String(message)}`,
});

const pingTool = defineTool({
  name: 'ping',
  description: 'No input at all.',
  handler: () => undefined,
});

const pixelTool = defineTool({
  name: 'pixel',
  description: 'Return an image.',
  handler: () => ({
    content: [{ type: 'image', data: 'iVBORw==', mimeType: 'image/png' }],
  }),
});

const clientTool = defineTool({
  name: 'whoami',
  description: 'Report the calling client.',
  handler: (_input, { client }) => client,
});

const failingTool = defineTool({
  name: 'explode',
  description: 'Always throws.',
  handler: () => {
    throw new Error('boom');
  },
});

const provider = defineSkillsProvider({
  name: 'acme',
  version: '1.2.3',
  skills: [releaseSkill],
  tools: [addTool, echoTool, pingTool, pixelTool, clientTool, failingTool],
});

// "modern" negotiates MCP 2026-07-28; "legacy" uses the 2025-11-25 handshake.
type Era = 'modern' | 'legacy';

// Both adapters build a gateway with the same web-standard handler.
const adapters = [
  ['the official MCP SDK', sdk.createSkillsGateway],
  ['Effect', effect.createSkillsGateway],
] as const;
type CreateGateway = (typeof adapters)[number][1];

const connectTo = async (
  web: {
    handler: (request: Request) => Promise<Response>;
    dispose: () => Promise<void>;
  },
  era: Era = 'modern',
) => {
  const client = new Client(
    { name: 'test', version: '1.0.0' },
    era === 'modern' ? { versionNegotiation: { mode: 'auto' } } : undefined,
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://gateway.test/mcp'), {
      fetch: (input, init) => web.handler(new Request(input, init)),
    }),
  );
  return {
    client,
    close: async () => {
      await client.close();
      await web.dispose();
    },
  };
};

const connect = async (
  create: CreateGateway,
  options: Partial<SkillsGatewayOptions> = {},
  era: Era = 'modern',
) => {
  const gateway = await create({ providers: [provider], ...options });
  return connectTo(gateway.toWebHandler(), era);
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

describe.each(adapters)('a gateway on %s', (_adapter, create) => {
  const isSdk = create === sdk.createSkillsGateway;
  it.each([
    ['modern', '2026-07-28'],
    ['legacy', '2025-11-25'],
  ] as const)(
    'serves skills, resources and tools to %s clients',
    async (era, version) => {
      const { client, close } = await connect(create, {}, era);
      try {
        expect(client.getNegotiatedProtocolVersion()).toBe(version);
        // There is no capability slot for extensions before 2026-07-28. The
        // SDK sends it anyway, which older clients ignore; Effect 4.0.0
        // drops it.
        expect(
          client.getServerCapabilities()?.extensions?.[SKILLS_EXTENSION],
        ).toEqual(
          era === 'modern' || isSdk ? { directoryRead: false } : undefined,
        );
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
        expect(
          `sha256:${createHash('sha256').update(text).digest('hex')}`,
        ).toBe(get.skill.resources[0]?.digest);

        const resources = await client.listResources();
        expect(resources.resources).toHaveLength(2);

        const tools = await client.listTools();
        const addListing = tools.tools.find((tool) => tool.name === 'add');
        expect(addListing?.inputSchema.properties).toHaveProperty('a');
        expect(
          addListing?._meta?.['io.github.module-federation/provider'],
        ).toBe('acme');

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

        const whoami = await client.callTool({ name: 'whoami' });
        // The SDK serves legacy HTTP clients statelessly, without a session
        // that remembers who they are.
        expect(whoami.structuredContent).toEqual({
          protocolVersion: version,
          info:
            era === 'legacy' && isSdk
              ? undefined
              : { name: 'test', version: '1.0.0' },
        });

        const ping = await client.callTool({ name: 'ping' });
        expect(ping.content).toEqual([]);

        const invalid = await client.callTool({
          name: 'add',
          arguments: { a: 'x' },
        });
        expect(invalid.isError).toBe(true);
        expect(textOf(invalid as never)).toMatch(
          /Invalid arguments for tool "add"/,
        );

        const failed = await client.callTool({ name: 'explode' });
        expect(failed).toMatchObject({
          isError: true,
          content: [{ type: 'text', text: 'boom' }],
        });

        const pixel = await client.callTool({ name: 'pixel' });
        expect(pixel.content).toEqual([
          { type: 'image', data: 'iVBORw==', mimeType: 'image/png' },
        ]);

        await expect(
          client.request(
            { method: 'skills/get', params: { uri: 'skill://nope/SKILL.md' } },
            GetSkillResultSchema,
          ),
        ).rejects.toThrow(/Unknown skill URI/);
      } finally {
        await close();
      }
    },
  );

  it('lets users override server metadata and instructions', async () => {
    const { client, close } = await connect(create, {
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
      await close();
    }
  });
});

describe('registerSkills', () => {
  it('adds skills and tools to a server the user owns', async () => {
    const catalog = await loadSkillsCatalog([provider]);
    const createServer = () => {
      const server = new McpServer(
        { name: 'own-server', version: '1.0.0' },
        { instructions: `Own notes.\n\n${defaultInstructions(catalog)}` },
      );
      server.registerTool(
        'own_tool',
        { description: 'Belongs to the host server.' },
        () => ({ content: [{ type: 'text', text: 'own' }] }),
      );
      sdk.registerSkills(server, catalog);
      return server;
    };
    const http = createMcpHandler(createServer);
    const { client, close } = await connectTo({
      handler: (request) => http.fetch(request),
      dispose: () => http.close(),
    });
    try {
      expect(client.getServerVersion()?.name).toBe('own-server');
      expect(client.getInstructions()).toMatch(
        /^Own notes\.[\s\S]*release-checklist/,
      );
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain('own_tool');
      expect(tools.tools.map((tool) => tool.name)).toContain('add');
      expect(
        textOf((await client.callTool({ name: 'own_tool' })) as never),
      ).toBe('own');
      const sum = await client.callTool({
        name: 'add',
        arguments: { a: 1, b: 2 },
      });
      expect(sum.structuredContent).toEqual({ sum: 3 });
      const list = await client.request(
        { method: 'skills/list', params: {} },
        ListSkillsResultSchema,
      );
      expect(list.skills).toHaveLength(1);
    } finally {
      await close();
    }
  });
});

describe('SkillsCatalog', () => {
  it('runs tools without any MCP server', async () => {
    const catalog = await loadSkillsCatalog([provider]);
    expect(
      catalog.listTools().find((tool) => tool.name === 'add'),
    ).toMatchObject({
      inputSchema: { type: 'object', required: ['a', 'b'] },
      _meta: { 'io.github.module-federation/provider': 'acme' },
    });
    expect(await catalog.callTool('add', { a: 1, b: 1 })).toMatchObject({
      structuredContent: { sum: 2 },
    });
    expect(await catalog.callTool('add', { a: 'x' })).toMatchObject({
      isError: true,
    });
    await expect(catalog.callTool('nope', {})).rejects.toThrow(/Unknown tool/);
    expect(
      catalog.readResource('skill://acme/release/release-checklist/SKILL.md'),
    ).toMatchObject({ mimeType: 'text/markdown' });
  });
});

describe('createSkillsGateway', () => {
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
    root = await mkdtemp(path.join(os.tmpdir(), 'federated-skills-'));
    const skillDir = path.join(root, 'pdf-tools');
    await mkdir(path.join(skillDir, 'scripts'), { recursive: true });
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: pdf-tools\ndescription: Work with PDF files.\n---\n# PDF\n',
    );
    await writeFile(path.join(skillDir, 'scripts', 'extract.py'), 'print(1)\n');
    await mkdir(path.join(skillDir, 'assets'));
    await writeFile(
      path.join(skillDir, 'assets', 'logo.png'),
      Buffer.from([0x89, 0x50]),
    );
    await writeFile(path.join(skillDir, '.hidden'), 'ignored');
    // Never served, as in a Zephyr deploy: evals, source maps and entries
    // outside SKILL.md, references/, assets/ and scripts/.
    await mkdir(path.join(skillDir, 'Evals'));
    await writeFile(path.join(skillDir, 'Evals', 'evals.json'), '{}');
    await mkdir(path.join(skillDir, 'scripts', 'evals'));
    await writeFile(path.join(skillDir, 'scripts', 'evals', 'run.py'), '');
    await writeFile(path.join(skillDir, 'scripts', 'extract.py.map'), '{}');
    await writeFile(path.join(skillDir, 'notes.txt'), 'stray');

    const loaded = await skillsDirectory(root, { namespace: 'local' })();
    expect(loaded.name).toBe(path.basename(root));
    const [skill] = loaded.skills;
    expect(skill?.path).toBe('local/pdf-tools');
    expect(Object.keys(skill?.files ?? {}).sort()).toEqual([
      'SKILL.md',
      'assets/logo.png',
      'scripts/extract.py',
    ]);
    expect(skill?.files['scripts/extract.py']).toEqual({
      mimeType: 'text/x-python',
      text: 'print(1)\n',
    });
    expect(skill?.files['assets/logo.png']).toMatchObject({
      mimeType: 'image/png',
    });

    const gateway = await createSkillsGateway({
      providers: [skillsDirectory(root)],
    });
    const logo = gateway.catalog.resources.find((resource) =>
      resource.uri.endsWith('logo.png'),
    );
    expect(logo?.size).toBe(2);
  });
});

describe('defineTool', () => {
  it('accepts a tool without a name and returns it unchanged', () => {
    const definition = {
      description: 'Named by its file.',
      handler: () => 'ok',
    };
    expect(defineTool(definition)).toBe(definition);
  });

  it('validates the name only when present', () => {
    expect(() =>
      defineTool({ name: 'lookup.order', description: 'x', handler: () => 1 }),
    ).toThrow(/Invalid tool name "lookup.order"/);
    expect(() =>
      defineTool({ name: 'x'.repeat(65), description: 'x', handler: () => 1 }),
    ).toThrow(/1-64/);
    // The handler is not checked here; the catalog refuses the tool, and
    // the preset reports ZD0736 for its file.
    const noHandler = {
      name: 'no_handler',
      description: 'x',
    } as unknown as Parameters<typeof defineTool>[0];
    expect(defineTool(noHandler)).toBe(noHandler);
    expect(() =>
      createSkillsCatalog([
        {
          ...defineSkillsProvider({ tools: [noHandler as never] }),
          name: 'p',
          source: 'local',
        },
      ]),
    ).toThrow(/"no_handler" in provider "p" has no handler/);
  });
});

describe('skill rules', () => {
  it('rejects non-string metadata', () => {
    expect(() =>
      defineSkill({
        markdown:
          '---\nname: a\ndescription: b\nmetadata:\n  version: 1.5\n---\n',
      }),
    ).toThrow(/metadata "version" must be a string/);
  });

  it('requires the folder name to equal the skill name and keeps bytes exact', async () => {
    const dir = await mkdtemp(
      path.join(os.tmpdir(), 'federated-skills-rules-'),
    );
    try {
      await mkdir(path.join(dir, 'folder', 'assets'), { recursive: true });
      await writeFile(
        path.join(dir, 'folder', 'SKILL.md'),
        '---\nname: other\ndescription: Mismatched folder.\n---\n',
      );
      await expect(skillsDirectory(dir)()).rejects.toThrow(
        /named "other" but its folder is "folder"/,
      );

      await writeFile(
        path.join(dir, 'folder', 'SKILL.md'),
        '---\nname: folder\ndescription: Matching folder.\n---\n',
      );
      // Text-typed by extension, but not UTF-8: served as a blob, so the
      // digest covers the bytes on disk.
      await writeFile(
        path.join(dir, 'folder', 'assets', 'latin1.txt'),
        Buffer.from([0xe9]),
      );
      await writeFile(
        path.join(dir, 'folder', 'assets', 'data.bin'),
        Buffer.from([1]),
      );
      const [skill] = (await skillsDirectory(dir)()).skills;
      expect(skill?.files['assets/latin1.txt']).toEqual({
        mimeType: 'text/plain',
        data: new Uint8Array([0xe9]),
      });
      expect(skill?.files['assets/data.bin']).toMatchObject({
        mimeType: 'application/octet-stream',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
