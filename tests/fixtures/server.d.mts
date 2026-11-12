// The low-level Server is deliberate: fixtures must return tool definitions exactly as written,
// including invalid ones that the high-level McpServer would refuse or normalize.
/* eslint-disable @typescript-eslint/no-deprecated */
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

export function buildFixtureServer(
  variant: 'good' | 'bad',
  options?: { baseUrl?: string; pageSize?: number },
): Server;
