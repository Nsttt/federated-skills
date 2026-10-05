import { readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import vm from 'node:vm';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { pluginModuleFederation } from '@module-federation/rsbuild-plugin';
import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack';
import {
  createRsbuild,
  rspack,
  type RsbuildConfig,
  type Rspack,
} from '@rsbuild/core';
import { afterAll, beforeAll, describe, expect, it } from '@rstest/core';
import { rawSourceRule, SkillsProviderPlugin } from '../src/build';
import { pluginFederatedSkills } from '../src/rsbuild';
import { createSkillsGateway } from '../src/mcp';

const fixtures = path.resolve(import.meta.dirname, 'fixtures');
const provider = path.join(fixtures, 'provider');
const app = path.join(fixtures, 'app');
const outRoot = path.join(provider, 'dist');

const buildWithRsbuild = async (cwd: string, config: RsbuildConfig) => {
  const rsbuild = await createRsbuild({
    cwd,
    rsbuildConfig: { logLevel: 'error', ...config },
  });
  await rsbuild.build();
};

const runRspack = (config: Rspack.Configuration) =>
  new Promise<void>((resolve, reject) => {
    rspack({
      mode: 'production',
      context: provider,
      entry: {},
      resolve: { extensions: ['.ts', '.js'] },
      ...config,
      module: {
        rules: [
          {
            test: /\.ts$/,
            loader: 'builtin:swc-loader',
            options: { jsc: { parser: { syntax: 'typescript' } } },
            type: 'javascript/auto',
          },
          rawSourceRule,
        ],
      },
    }).run((error, stats) => {
      if (error) return reject(error);
      if (stats?.hasErrors())
        return reject(new Error(stats.toString('errors-only')));
      resolve();
    });
  });

const builds: Record<string, () => Promise<void>> = {
  // pluginFederatedSkills on its own: the provider is the whole build.
  rsbuild_provider: () =>
    buildWithRsbuild(provider, {
      output: { distPath: { root: path.join(outRoot, 'rsbuild_provider') } },
      plugins: [
        pluginFederatedSkills({
          name: 'rsbuild_provider',
          provider: './skills.ts',
        }),
      ],
    }),
  // An app that is already a web remote; the provider takes its name and
  // builds next to it in dist/skills.
  rsbuild_app: () =>
    buildWithRsbuild(app, {
      output: { distPath: { root: path.join(outRoot, 'rsbuild_app') } },
      plugins: [
        pluginModuleFederation({
          name: 'rsbuild_app',
          exposes: { './button': './src/button.ts' },
          dts: false,
        }),
        pluginFederatedSkills({ provider: './src/skills.ts' }),
      ],
    }),
  // The official plugin by hand, with Rsbuild's default asset prefix.
  rsbuild_official: () =>
    buildWithRsbuild(provider, {
      environments: {
        node: {
          source: { entry: { index: './skills.ts' } },
          output: {
            target: 'node',
            distPath: { root: path.join(outRoot, 'rsbuild_official') },
          },
        },
      },
      tools: { rspack: { module: { rules: [rawSourceRule] } } },
      plugins: [
        pluginModuleFederation(
          {
            name: 'rsbuild_official',
            exposes: { './skills': './skills.ts' },
            dts: false,
          },
          { target: 'node', environment: 'node' },
        ),
      ],
    }),
  rspack_provider: () =>
    runRspack({
      target: 'async-node',
      output: {
        path: path.join(outRoot, 'rspack_provider'),
        publicPath: 'auto',
      },
      plugins: [
        new SkillsProviderPlugin({
          name: 'rspack_provider',
          provider: './skills.ts',
        }),
      ],
    }),
  rspack_esm: () =>
    runRspack({
      target: 'node',
      output: {
        path: path.join(outRoot, 'rspack_esm'),
        publicPath: 'auto',
        module: true,
        chunkFormat: 'module',
        chunkLoading: 'import',
        library: { type: 'module' },
      },
      plugins: [
        new ModuleFederationPlugin({
          name: 'rspack_esm',
          filename: 'remoteEntry.js',
          manifest: true,
          dts: false,
          library: { type: 'module' },
          exposes: { './skills': './skills.ts' },
        }),
      ],
    }),
};

// Each build gets its own origin, so root-relative asset prefixes resolve
// the way they would on a real host.
const servers: Server[] = [];
const origins: Record<string, string> = {};

const serve = async (root: string) => {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://x').pathname;
    readFile(path.join(root, pathname)).then(
      (body) => response.end(body),
      () => response.writeHead(404).end(),
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

beforeAll(async () => {
  await rm(outRoot, { recursive: true, force: true });
  // Rsbuild builds share process-wide state, so run them one at a time.
  for (const build of Object.values(builds)) await build();
  for (const name of Object.keys(builds)) {
    origins[name] = await serve(path.join(outRoot, name));
  }
}, 180_000);

afterAll(async () => {
  await Promise.all(
    servers.map((server) => new Promise((resolve) => server.close(resolve))),
  );
  await rm(outRoot, { recursive: true, force: true });
});

const gatewayFor = (name: string, entry: string) =>
  createSkillsGateway({
    providers: [`${name}@${origins[name]}/${entry}`],
    federation: { name: `host_${name}_${entry.replace(/\W/g, '_')}` },
  });

describe.each([
  ['rsbuild_provider', 'mf-manifest.json'],
  ['rsbuild_provider', 'remoteEntry.js'],
  ['rsbuild_app', 'skills/mf-manifest.json'],
  ['rsbuild_official', 'mf-manifest.json'],
  ['rsbuild_official', 'rsbuild_official.js'],
  ['rspack_provider', 'mf-manifest.json'],
])('a provider built as %s, loaded from %s', (name, entry) => {
  it('serves its skills and tools through the gateway', async () => {
    const gateway = await gatewayFor(name, entry);
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

describe('pluginFederatedSkills next to an existing web remote', () => {
  it('leaves the web remote in dist/ and puts the provider in dist/skills/', async () => {
    const read = async (file: string) =>
      JSON.parse(
        await readFile(path.join(outRoot, 'rsbuild_app', file), 'utf8'),
      ) as {
        name: string;
        metaData: { remoteEntry: { type: string } };
        exposes: { path: string }[];
      };
    const web = await read('mf-manifest.json');
    const skills = await read('skills/mf-manifest.json');
    expect(web.metaData.remoteEntry.type).toBe('global');
    expect(web.exposes.map((expose) => expose.path)).toEqual(['./button']);
    expect(skills.name).toBe('rsbuild_app');
    expect(skills.metaData.remoteEntry.type).toBe('commonjs-module');
    expect(skills.exposes.map((expose) => expose.path)).toEqual(['./skills']);
  });
});

describe('pluginFederatedSkills on the Rsbuild dev server', () => {
  it('serves the provider next to the web remote', async () => {
    const rsbuild = await createRsbuild({
      cwd: app,
      rsbuildConfig: {
        logLevel: 'error',
        server: { port: 4380, printUrls: false },
        output: { distPath: { root: path.join(outRoot, 'rsbuild_app_dev') } },
        plugins: [
          pluginModuleFederation({
            name: 'rsbuild_app_dev',
            exposes: { './button': './src/button.ts' },
            dts: false,
          }),
          pluginFederatedSkills({ provider: './src/skills.ts' }),
        ],
      },
    });
    const { port, server } = await rsbuild.startDevServer();
    try {
      const origin = `http://localhost:${port}`;
      const web = await fetch(`${origin}/mf-manifest.json`);
      expect(
        ((await web.json()) as { exposes: { path: string }[] }).exposes,
      ).toMatchObject([{ path: './button' }]);

      const gateway = await createSkillsGateway({
        providers: [`rsbuild_app_dev@${origin}/skills/mf-manifest.json`],
        federation: { name: 'host_rsbuild_app_dev' },
      });
      expect(gateway.catalog.tools.map(({ tool }) => tool.name)).toEqual([
        'greet',
      ]);
    } finally {
      await server.close();
    }
  });
});

describe('an ES module remote', () => {
  // First: once the runtime has loaded a remote, it reuses it.
  it('fails with a message that says how to build a loadable one', async () => {
    const { SourceTextModule } = vm;
    Object.assign(vm, { SourceTextModule: undefined });
    try {
      for (const entry of ['mf-manifest.json', 'remoteEntry.js']) {
        await expect(gatewayFor('rspack_esm', entry)).rejects.toThrow(
          /ES module remote.*--experimental-vm-modules/,
        );
      }
    } finally {
      Object.assign(vm, { SourceTextModule });
    }
  });

  it.runIf(typeof vm.SourceTextModule === 'function')(
    'loads when Node runs with --experimental-vm-modules',
    async () => {
      const gateway = await gatewayFor('rspack_esm', 'mf-manifest.json');
      expect(gateway.catalog.tools.map(({ tool }) => tool.name)).toEqual([
        'greet',
      ]);
    },
  );
});
