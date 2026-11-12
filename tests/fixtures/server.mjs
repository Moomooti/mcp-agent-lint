import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { badTools, callTool, goodTools } from './definitions.mjs';

/**
 * A low-level MCP server that returns exactly the given tool definitions.
 * (The high-level McpServer would normalize them, and the bad fixture needs to stay bad.)
 * `pageSize` splits tools/list into pages to exercise cursor handling.
 */
export function buildFixtureServer(variant, { baseUrl, pageSize } = {}) {
  const tools = variant === 'good' ? goodTools : badTools;
  const server = new Server({ name: `fixture-${variant}`, version: '1.0.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, (req) => {
    if (!pageSize) return { tools };
    const start = Number(req.params?.cursor ?? 0);
    const next = start + pageSize;
    return { tools: tools.slice(start, next), ...(next < tools.length ? { nextCursor: String(next) } : {}) };
  });
  server.setRequestHandler(CallToolRequestSchema, (req) =>
    callTool(req.params.name, req.params.arguments ?? {}, { variant, ...(baseUrl ? { baseUrl } : {}) }),
  );
  return server;
}
