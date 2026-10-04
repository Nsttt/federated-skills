import path from 'node:path';
import {
  createSkillsGateway,
  parseRemoteSource,
  skillsDirectory,
} from '@module-federation/federated-skills/server';

// The dev servers of ../releases and ../billing. Override with
// SKILLS_REMOTES="name@url name@url" to point at deployed builds.
const remotes = (
  process.env.SKILLS_REMOTES ??
  'releases@http://localhost:3001/mf-manifest.json billing@http://localhost:3002/skills/mf-manifest.json'
).split(/\s+/);

const gateway = await createSkillsGateway({
  name: 'acme-skills',
  providers: [
    // Skip a provider whose dev server isn't running instead of failing.
    ...remotes.map((remote) => ({
      ...parseRemoteSource(remote),
      optional: true,
    })),
    // Plain SKILL.md folders from disk, served next to the remotes.
    skillsDirectory(path.join(import.meta.dirname, 'skills')),
  ],
});

await gateway.serveStdio();
