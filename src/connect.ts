import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { VERSION } from './version.js';

export type Target =
  | { kind: 'http'; url: string; headers?: Record<string, string> }
  | { kind: 'stdio'; command: string; args?: string[]; cwd?: string };

export class ConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectionError';
  }
}

const CLIENT_INFO = { name: 'mcp-agent-lint', version: VERSION };
const STDERR_TAIL_LINES = 20;

export interface Connection {
  client: Client;
  close(): Promise<void>;
}

/** Connects to an MCP server over Streamable HTTP or stdio, with a timeout on the handshake. */
export async function connect(target: Target, { timeoutMs = 30_000 } = {}): Promise<Connection> {
  let transport: Transport;
  const stderrTail: string[] = [];

  if (target.kind === 'http') {
    let url: URL;
    try {
      url = new URL(target.url);
    } catch {
      throw new ConnectionError(`Not a valid URL: ${target.url}`);
    }
    transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: target.headers ?? {} } });
  } else {
    const stdio = new StdioClientTransport({
      command: target.command,
      args: target.args ?? [],
      ...(target.cwd ? { cwd: target.cwd } : {}),
      // Keep the server's logs out of our report, but remember the end for error messages.
      stderr: 'pipe',
    });
    stdio.stderr?.on('data', (chunk: Buffer) => {
      stderrTail.push(...chunk.toString('utf8').split('\n').filter(Boolean));
      stderrTail.splice(0, Math.max(0, stderrTail.length - STDERR_TAIL_LINES));
    });
    transport = stdio;
  }

  const client = new Client(CLIENT_INFO);
  try {
    await client.connect(transport, { timeout: timeoutMs });
  } catch (err) {
    await transport.close().catch(() => undefined);
    const where = target.kind === 'http' ? target.url : [target.command, ...(target.args ?? [])].join(' ');
    const reason = err instanceof Error ? err.message : String(err);
    const logs = stderrTail.length > 0 ? `\nServer stderr (last lines):\n${stderrTail.join('\n')}` : '';
    throw new ConnectionError(`Could not connect to ${where}: ${reason}${logs}`);
  }
  return { client, close: () => client.close() };
}
