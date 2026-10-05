import { createServer } from 'node:http';
import { createMcpHandler } from '@modelcontextprotocol/server';
import {
  localhostOriginValidation,
  toNodeHandler,
} from '@modelcontextprotocol/node';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadCatalog } from './catalog.ts';
import { createGatewayServer, summary } from './server.ts';

const catalog = await loadCatalog();
console.error(summary(catalog));

if (process.argv.includes('--http')) {
  // One gateway for the whole company: deploy it once, and every engineer
  // adds the URL to their MCP client.
  const port = Number(process.env.PORT ?? 3000);
  const handler = toNodeHandler(
    createMcpHandler(() => createGatewayServer(catalog)),
  );
  // Browsers may only call it from localhost pages. Put your SSO proxy in
  // front of it for real deployments.
  const allowOrigin = localhostOriginValidation();
  createServer((req, res) => {
    if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/mcp') {
      res.writeHead(404).end();
      return;
    }
    if (allowOrigin(req, res)) void handler(req, res);
  }).listen(port, () => {
    console.error(`[acme-skills] http://localhost:${port}/mcp`);
  });
} else {
  // Or run it locally as a stdio server, next to the engineer's agent.
  serveStdio(() => createGatewayServer(catalog));
}
