import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { registerSkills } from '@module-federation/federated-skills/mcp';
import {
  defaultInstructions,
  loadSkillsCatalog,
  parseRemoteSource,
  skillsDirectory,
} from '@module-federation/federated-skills/server';

// The dev servers of ../releases and ../billing. Override with
// SKILLS_REMOTES="name@url name@url" to point at deployed builds.
const remotes = (
  process.env.SKILLS_REMOTES ??
  'releases@http://localhost:3001/mf-manifest.json billing@http://localhost:3002/skills/mf-manifest.json'
).split(/\s+/);

const catalog = await loadSkillsCatalog([
  // Skip a provider whose dev server isn't running instead of failing.
  ...remotes.map((remote) => ({
    ...parseRemoteSource(remote),
    optional: true,
  })),
  // Plain SKILL.md folders from disk, served next to the remotes.
  skillsDirectory(path.join(import.meta.dirname, 'skills')),
]);

// An MCP server of our own. The skills and tools from the catalog sit next
// to anything else it serves.
serveStdio(() => {
  const server = new McpServer(
    { name: 'acme-skills', version: '1.0.0' },
    { instructions: defaultInstructions(catalog) },
  );
  server.registerTool(
    'list_providers',
    { description: 'List the skills providers this gateway loaded.' },
    () => ({
      content: [
        {
          type: 'text',
          text: catalog.providers
            .map((provider) => `${provider.name}: ${provider.source}`)
            .join('\n'),
        },
      ],
    }),
  );
  registerSkills(server, catalog);
  return server;
});
