import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildFixtureServer } from './server.mjs';

// Usage: node stdio-server.mjs good|bad|crash
const variant = process.argv[2] ?? 'good';
if (variant === 'crash') {
  console.error('fixture: failed to open database ./data/game.db');
  process.exit(1);
}
await buildFixtureServer(variant).connect(new StdioServerTransport());
