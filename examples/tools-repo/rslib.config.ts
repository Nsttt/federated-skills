import { defineMcpConfig } from '@module-federation/mcp/rslib';

// Builds tools/*.ts into dist/tools/index.js and writes the provider
// artifact (catalog.json, mcp-provider.json, skills/) to dist/. The provider
// is named after package.json: "@acme/billing-tools" becomes "billing-tools".
export default defineMcpConfig();
