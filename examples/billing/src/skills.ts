import {
  defineSkill,
  defineSkillsProvider,
  defineTool,
} from '@module-federation/federated-skills';
import * as z from 'zod';
import { quote } from './pricing';

// The tool runs the same pricing code as the checkout UI.
export default defineSkillsProvider({
  version: '1.0.0',
  skills: [
    defineSkill({
      name: 'pricing-questions',
      namespace: 'acme/billing',
      description:
        'Use when someone asks what a plan costs, or compares monthly and yearly billing.',
      instructions: [
        '# Pricing questions',
        '',
        'Never work out prices yourself. Call `quote_price` for every plan and',
        'billing period the user asks about, then compare the totals.',
        'Yearly billing is charged up front for ten months.',
      ].join('\n'),
    }),
  ],
  tools: [
    defineTool({
      name: 'quote_price',
      description: 'Quote a plan for a number of seats.',
      inputSchema: z.object({
        plan: z.enum(['starter', 'team', 'enterprise']),
        seats: z.number().int().positive(),
        billing: z.enum(['monthly', 'yearly']).default('monthly'),
      }),
      annotations: { readOnlyHint: true },
      handler: ({ plan, seats, billing }) => ({
        ...quote(plan, seats, billing),
      }),
    }),
  ],
});
