import { McpServer } from '@modelcontextprotocol/server';
import { registerSkills } from '@module-federation/mcp/server';
import {
  defaultInstructions,
  type SkillsCatalog,
} from '@module-federation/mcp/catalog';
import { withAuditLog } from './audit.ts';
import { environment, unavailable } from './catalog.ts';
import { platform, registry } from './registry.ts';

const teams = (catalog: SkillsCatalog) =>
  [...registry, platform].map((provider) => {
    const loaded = catalog.providers.find(({ name }) => name === provider.name);
    return {
      team: provider.team,
      contact: provider.contact,
      provider: provider.name,
      status: loaded ? 'available' : 'unavailable',
      skills: catalog.skills
        .filter(
          (skill) =>
            catalog.getResource(skill.uri)?.provider.name === provider.name,
        )
        .map((skill) => skill.uri),
      tools: catalog.tools
        .filter((entry) => entry.provider.name === provider.name)
        .map((entry) => entry.tool.name),
    };
  });

/**
 * The platform team's MCP server: its own tool, plus every team's skills and
 * tools from the catalog.
 */
export const createGatewayServer = (catalog: SkillsCatalog) => {
  const server = new McpServer(
    { name: 'acme-skills', version: '1.0.0' },
    {
      instructions: `${defaultInstructions(catalog)}\n\nEvery skill and tool belongs to a team. Call list_teams to find who owns one and how to reach them.`,
    },
  );

  server.registerTool(
    'list_teams',
    {
      title: 'List teams',
      description:
        'Which team owns each skill and tool, how to reach them, and whether their provider is available right now.',
      annotations: { readOnlyHint: true },
    },
    () => {
      const result = { environment, teams: teams(catalog) };
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  registerSkills(server, withAuditLog(catalog));
  return server;
};

export const summary = (catalog: SkillsCatalog) => {
  const missing = unavailable(catalog).map((provider) => provider.name);
  return `[acme-skills] ${environment}: ${catalog.skills.length} skills and ${catalog.tools.length} tools from ${catalog.providers.map((provider) => provider.name).join(', ')}${missing.length ? ` (unavailable: ${missing.join(', ')})` : ''}`;
};
