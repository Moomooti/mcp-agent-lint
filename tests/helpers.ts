import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildFixtureServer } from './fixtures/server.mjs';

/** An MCP client connected in-process to a fixture server. */
export async function connectFixture(
  variant: 'good' | 'bad',
  options: { baseUrl?: string; pageSize?: number } = {},
): Promise<Client> {
  const server = buildFixtureServer(variant, options);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

/** A fetch stand-in: every URL returns the status from the map (default 200). */
export function fakeFetch(statuses: Record<string, number> = {}): typeof globalThis.fetch {
  return (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (statuses[url] === -1) return Promise.reject(new Error('ECONNREFUSED'));
    return Promise.resolve(new Response(null, { status: statuses[url] ?? 200 }));
  };
}
