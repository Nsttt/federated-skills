import type { SkillsCatalog } from '@module-federation/federated-skills/server';

/**
 * Log every tool call as a JSON line on stderr: which tool, which team's
 * provider ran it, which client asked, and how it went. Ship these lines to
 * your log pipeline.
 *
 * The catalog is a plain object, so wrapping `callTool` is all it takes;
 * `registerSkills()` calls tools through it.
 */
export const withAuditLog = (catalog: SkillsCatalog): SkillsCatalog => ({
  ...catalog,
  callTool: async (name, args, options) => {
    const started = performance.now();
    const result = await catalog.callTool(name, args, options);
    const entry = {
      audit: 'tools/call',
      at: new Date().toISOString(),
      tool: name,
      provider: catalog.tools.find(({ tool }) => tool.name === name)?.provider
        .name,
      client: options?.client?.info?.name ?? 'unknown',
      ok: !result.isError,
      ms: Math.round(performance.now() - started),
    };
    console.error(JSON.stringify(entry));
    return result;
  },
});
