import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  createSkillsGateway,
  parseRemoteSource,
  skillsDirectory,
  type SkillsGatewayOptions,
  type SkillsProviderSource,
} from './server/index';

const HELP = `Usage: mf-skills-mcp [options]

Serve skills and tools from Module Federation remotes over MCP (stdio).

Options:
  -r, --remote <name@url>  Load a skills provider remote; repeatable.
                           "name=url" works too. The url points at the
                           remote's mf-manifest.json or remoteEntry.js.
  -d, --dir <path>         Serve <path>/<skill>/SKILL.md folders; repeatable.
  -c, --config <file>      Load gateway options from a module's default export.
      --expose <key>       Module exposed by --remote providers (default ./skills).
      --name <name>        MCP server name.
  -h, --help               Show this help.
  -v, --version            Show the version.

Environment:
  MF_SKILLS_REMOTES        Remotes to load, separated by commas or spaces.

Example:
  mf-skills-mcp --remote billing@https://cdn.example.com/billing/mf-manifest.json
`;

const toRemote = (value: string, expose: string | undefined) => {
  const normalized = /^[^=@]+=/.test(value) ? value.replace('=', '@') : value;
  return { ...parseRemoteSource(normalized), expose };
};

const loadConfig = async (
  file: string,
): Promise<Partial<SkillsGatewayOptions>> => {
  const module = (await import(pathToFileURL(path.resolve(file)).href)) as {
    default?: unknown;
  };
  const config = await (typeof module.default === 'function'
    ? module.default()
    : module.default);
  if (!config || typeof config !== 'object') {
    throw new Error(`${file} must default-export gateway options`);
  }
  return config as Partial<SkillsGatewayOptions>;
};

const main = async () => {
  const { values } = parseArgs({
    options: {
      remote: { type: 'string', short: 'r', multiple: true },
      dir: { type: 'string', short: 'd', multiple: true },
      config: { type: 'string', short: 'c' },
      expose: { type: 'string' },
      name: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });

  if (values.help) {
    process.stdout.write(HELP);
    return;
  }
  if (values.version) {
    process.stdout.write(`${__VERSION__}\n`);
    return;
  }

  const config = values.config ? await loadConfig(values.config) : {};
  const envRemotes = (process.env['MF_SKILLS_REMOTES'] ?? '')
    .split(/[\s,]+/)
    .filter(Boolean);

  const providers: SkillsProviderSource[] = [
    ...(config.providers ?? []),
    ...[...envRemotes, ...(values.remote ?? [])].map((value) =>
      toRemote(value, values.expose),
    ),
    ...(values.dir ?? []).map((dir) => skillsDirectory(dir)),
  ];

  if (providers.length === 0) {
    process.stderr.write(`No providers configured.\n\n${HELP}`);
    process.exitCode = 1;
    return;
  }

  const gateway = await createSkillsGateway({
    ...config,
    name: values.name ?? config.name,
    providers,
    logger: config.logger ?? console,
  });
  const { catalog } = gateway;
  console.error(
    `[skills-mcp] serving ${catalog.skills.length} skill(s) and ${catalog.tools.length} tool(s) from ${catalog.providers.map((provider) => provider.name).join(', ')}`,
  );
  gateway.serveStdio();
};

main().catch((error: unknown) => {
  console.error(
    `[skills-mcp] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
