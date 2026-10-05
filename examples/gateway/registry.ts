/**
 * Every team that ships skills registers its provider here, like any other
 * service. The platform team reviews changes to this file, and `pnpm check`
 * runs in CI before the gateway deploys.
 */
export interface TeamProvider {
  /** Remote name, the `name` in the team's build config. */
  name: string;
  team: string;
  /** Where to ask about the team's skills and tools. */
  contact: string;
  /** Where the provider is served in each environment. */
  entry: Record<Environment, string>;
}

export type Environment = 'dev' | 'prod';

export const registry: TeamProvider[] = [
  {
    name: 'releases',
    team: 'Release Engineering',
    contact: '#release-eng',
    entry: {
      dev: 'http://localhost:3001/mf-manifest.json',
      prod: 'https://skills.acme.example/releases/mf-manifest.json',
    },
  },
  {
    name: 'billing',
    team: 'Billing',
    contact: '#billing-eng',
    // Billing ships its skills with the checkout app, under /skills/.
    entry: {
      dev: 'http://localhost:3002/skills/mf-manifest.json',
      prod: 'https://app.acme.example/billing/skills/mf-manifest.json',
    },
  },
  {
    name: 'support',
    team: 'Support Tools',
    contact: '#support-tools',
    entry: {
      dev: 'http://localhost:3003/mf-manifest.json',
      prod: 'https://skills.acme.example/support/mf-manifest.json',
    },
  },
];

/** The platform team's own skills, served from ./skills in this repo. */
export const platform = {
  name: 'platform',
  team: 'Platform',
  contact: '#platform',
};
