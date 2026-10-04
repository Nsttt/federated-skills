import { readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { createRsbuild, rspack } from '@rsbuild/core';
import { afterAll, beforeAll, describe, expect, it } from '@rstest/core';
import { SkillsProviderPlugin } from '../src/build';
import { pluginFederatedSkills } from '../src/rsbuild';
import { createSkillsGateway } from '../src/server';

const fixture = path.resolve(import.meta.dirname, 'fixtures/provider');
const outRoot = path.join(fixture, 'dist');

const buildWithRsbuild = async (name: string) => {
  const rsbuild = await createRsbuild({
    cwd: fixture,
    rsbuildConfig: {
      logLevel: 'error',
      output: { distPath: { root: path.join(outRoot, name) } },
      plugins: [pluginFederatedSkills({ name, provider: './skills.ts' })],
    },
  });
  await rsbuild.build();
};

const buildWithRspack = (name: string) =>
  new Promise<void>((resolve, reject) => {
    rspack({
      mode: 'production',
      target: 'async-node',
      context: fixture,
      entry: {},
      output: { path: path.join(outRoot, name), publicPath: 'auto' },
      resolve: { extensions: ['.ts', '.js'] },
      module: {
        rules: [
          {
            test: /\.ts$/,
            loader: 'builtin:swc-loader',
            options: { jsc: { parser: { syntax: 'typescript' } } },
            type: 'javascript/auto',
          },
        ],
      },
      plugins: [new SkillsProviderPlugin({ name, provider: './skills.ts' })],
    }).run((error, stats) => {
      if (error) return reject(error);
      if (stats?.hasErrors())
        return reject(new Error(stats.toString('errors-only')));
      resolve();
    });
  });

let server: Server;
let origin = '';

beforeAll(async () => {
  await rm(outRoot, { recursive: true, force: true });
  await Promise.all([
    buildWithRsbuild('rsbuild_provider'),
    buildWithRspack('rspack_provider'),
  ]);
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://x').pathname;
    try {
      response.end(await readFile(path.join(outRoot, pathname)));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120_000);

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await rm(outRoot, { recursive: true, force: true });
});

describe.each([
  ['rsbuild_provider', 'mf-manifest.json'],
  ['rspack_provider', 'mf-manifest.json'],
  ['rsbuild_provider', 'remoteEntry.js'],
])('a provider built with %s, loaded from %s', (name, file) => {
  it('serves its skills and tools through the gateway', async () => {
    const gateway = await createSkillsGateway({
      providers: [`${name}@${origin}/${name}/${file}`],
      federation: { name: `host_${name}_${file.replace(/\W/g, '_')}` },
    });
    expect(gateway.catalog.skills.map((skill) => skill.uri)).toEqual([
      'skill://hello/SKILL.md',
    ]);

    const web = gateway.toWebHandler();
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL('http://gateway.test/mcp'), {
        fetch: (input, init) => web.handler(new Request(input, init)),
      }),
    );
    try {
      const result = await client.callTool({
        name: 'greet',
        arguments: { who: 'ada' },
      });
      expect(result.content).toEqual([
        { type: 'text', text: `hi ada from ${name}` },
      ]);
    } finally {
      await client.close();
      await web.dispose();
    }
  });
});
