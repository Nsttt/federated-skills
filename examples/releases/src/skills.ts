import {
  defineSkill,
  defineSkillsProvider,
  defineTool,
} from '@module-federation/federated-skills';
import * as z from 'zod';
import gates from './release-checklist/references/gates.md?raw';
import checklist from './release-checklist/SKILL.md?raw';
import { releases } from './releases';

export default defineSkillsProvider({
  version: '1.0.0',
  // Every Acme team ships its skills under acme/<team>/, so two teams can
  // both have a "rollback" skill without clashing.
  skills: [
    // An existing SKILL.md and its references, served byte-for-byte.
    defineSkill({
      markdown: checklist,
      namespace: 'acme/releases',
      files: { 'references/gates.md': gates },
    }),
    // A skill written inline; the SDK generates its SKILL.md.
    defineSkill({
      name: 'rollback',
      namespace: 'acme/releases',
      description: 'Use when a live release must be reverted.',
      allowedTools: ['list_releases'],
      metadata: { owner: 'release-engineering', contact: '#release-eng' },
      instructions: [
        '# Rollback',
        '',
        '1. Call `list_releases` and find the newest release that is `live`.',
        '2. Find the release before it that was never rolled back.',
        '3. Tell the user which version you would redeploy and why.',
      ].join('\n'),
    }),
  ],
  tools: [
    defineTool({
      name: 'list_releases',
      description: 'List recent releases with their status.',
      inputSchema: z.object({
        status: z.enum(['live', 'rolled-back', 'staged']).optional(),
      }),
      annotations: { readOnlyHint: true },
      handler: ({ status }) => ({
        releases: releases.filter(
          (release) => !status || release.status === status,
        ),
      }),
    }),
    defineTool({
      name: 'lookup_release',
      description: 'Fetch one release by version.',
      inputSchema: z.object({ version: z.string() }),
      annotations: { readOnlyHint: true },
      handler: ({ version }) => {
        const release = releases.find((item) => item.version === version);
        if (!release) throw new Error(`No release ${version}`);
        return { ...release };
      },
    }),
  ],
});
