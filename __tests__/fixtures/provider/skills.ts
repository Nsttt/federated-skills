// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- this fixture builds outside the package
/// <reference path="../../../raw.d.ts" />
import * as z from 'zod';
import { defineSkill, defineSkillsProvider, defineTool } from '../../../src';
import skillMd from './hello/SKILL.md?raw';

export default defineSkillsProvider({
  version: '1.0.0',
  skills: [defineSkill({ markdown: skillMd })],
  tools: [
    defineTool({
      name: 'greet',
      description: 'Greet someone by name.',
      inputSchema: z.object({ who: z.string() }),
      handler: ({ who }, { provider }) => `hi ${who} from ${provider.name}`,
    }),
  ],
});
