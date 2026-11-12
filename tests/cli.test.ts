import { createServer, type Server as HttpServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { EXIT, main } from '../src/cli.js';
import { buildFixtureServer } from './fixtures/server.mjs';
import { fakeFetch } from './helpers.js';

const STDIO_SERVER = path.join(import.meta.dirname, 'fixtures', 'stdio-server.mjs');

async function run(args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(args, { stdout: (t) => out.push(t), stderr: (t) => err.push(t), color: false, fetch: fakeFetch() });
  return { code, stdout: out.join('\n'), stderr: err.join('\n') };
}

async function writeProbe(calls: unknown[]): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'mcp-agent-lint-'));
  const file = path.join(dir, 'probe.json');
  await writeFile(file, JSON.stringify({ calls }));
  return file;
}

describe('CLI over stdio', () => {
  it('exits 0 and says so for a clean server', async () => {
    const { code, stdout } = await run(['--stdio', '--', process.execPath, STDIO_SERVER, 'good']);
    expect(code).toBe(EXIT.ok);
    expect(stdout).toContain('fixture-good 1.0.0 · 3 tools');
    expect(stdout).toContain('✔ No problems found.');
  });

  it('exits 1 and lists findings grouped by tool for a bad server', async () => {
    const { code, stdout } = await run(['--stdio', '--', process.execPath, STDIO_SERVER, 'bad']);
    expect(code).toBe(EXIT.lintFailed);
    expect(stdout).toMatch(/^throw poop!$/m);
    expect(stdout).toMatch(/error {2}input\.room {2}Parameter "room" has no description.* {2}param-description/);
    expect(stdout).toContain('✖ 8 errors, 2 warnings');
  });

  it('can relax rules from the command line', async () => {
    const { code } = await run([
      '--rule', 'tool-name=off', '--rule', 'tool-description=off', '--rule', 'param-description=warn',
      '--stdio', '--', process.execPath, STDIO_SERVER, 'bad',
    ]);
    expect(code).toBe(EXIT.ok);
  });

  it('fails on warnings above --max-warnings', async () => {
    const { code, stderr } = await run([
      '--rule', 'tool-name=off', '--rule', 'tool-description=off', '--rule', 'param-description=warn', '--max-warnings', '3',
      '--stdio', '--', process.execPath, STDIO_SERVER, 'bad',
    ]);
    expect(code).toBe(EXIT.lintFailed);
    expect(stderr).toMatch(/Too many warnings: \d+ \(max 3\)/);
  });

  it('shows the server stderr when it dies on startup', async () => {
    const { code, stderr } = await run(['--timeout', '5000', '--stdio', '--', process.execPath, STDIO_SERVER, 'crash']);
    expect(code).toBe(EXIT.usage);
    expect(stderr).toContain('failed to open database ./data/game.db');
  });
});

describe('CLI over Streamable HTTP', () => {
  let http: HttpServer;
  let url: string;

  beforeAll(async () => {
    // Stateless, like most hosted MCP servers: a fresh server + transport per request.
    http = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        void (async () => {
          const body: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
          const server = buildFixtureServer(req.headers['x-fixture'] === 'bad' ? 'bad' : 'good', { baseUrl: url });
          const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
          res.on('close', () => void server.close());
          await server.connect(transport);
          await transport.handleRequest(req, res, body);
        })();
      });
    });
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((r) => http.close(() => { r(); })));

  it('lints and probes a server by URL, as JSON', async () => {
    const probe = await writeProbe([{ tool: 'check_status', arguments: { room_code: 'r', nickname: 'a' } }]);
    const { code, stdout } = await run([`${url}/mcp`, '--probe', probe, '--check-links', '--format', 'json']);
    expect(code).toBe(EXIT.ok);
    expect(JSON.parse(stdout)).toMatchObject({ toolCount: 3, probeCount: 1, errorCount: 0, findings: [] });
  });

  it('sends custom headers (e.g. auth) with every request', async () => {
    const { code, stdout } = await run([`${url}/mcp`, '-H', 'X-Fixture: bad', '--format', 'json']);
    expect(code).toBe(EXIT.lintFailed);
    expect(JSON.parse(stdout)).toMatchObject({ server: { name: 'fixture-bad' }, errorCount: 8 });
  });

  it('exits 2 with a clear message when nothing is listening', async () => {
    const { code, stderr } = await run(['http://127.0.0.1:9/mcp', '--timeout', '3000']);
    expect(code).toBe(EXIT.usage);
    expect(stderr).toMatch(/Could not connect to http:\/\/127\.0\.0\.1:9\/mcp/);
  });
});

describe('CLI usage errors (exit 2, nothing is called)', () => {
  it.each([
    [[], /exactly one server URL/],
    [['a', 'b'], /exactly one server URL/],
    [['--stdio'], /--stdio needs a command/],
    [['http://x.test', '--format', 'xml'], /--format must be/],
    [['http://x.test', '--rule', 'tool-name'], /--rule expects/],
    [['http://x.test', '--max-tools', '2.5'], /non-negative integer/],
    [['http://x.test', '--header', 'no-colon'], /--header expects/],
    [['http://x.test', '--bogus'], /Unknown option '--bogus'/],
    [['not a url'], /Not a valid URL/],
  ])('%j', async (args, message) => {
    const { code, stderr } = await run(args);
    expect(code).toBe(EXIT.usage);
    expect(stderr).toMatch(message);
  });

  it('rejects an unknown rule id', async () => {
    const { code, stderr } = await run(['--rule', 'tool-nmae=off', '--stdio', '--', process.execPath, STDIO_SERVER, 'good']);
    expect(code).toBe(EXIT.usage);
    expect(stderr).toContain('Unknown rule "tool-nmae"');
  });

  it('explains what is wrong with a probe file', async () => {
    const probe = await writeProbe([{ arguments: {} }]);
    const { code, stderr } = await run(['--probe', probe, '--stdio', '--', process.execPath, STDIO_SERVER, 'good']);
    expect(code).toBe(EXIT.usage);
    expect(stderr).toMatch(/Invalid probe file .*\n {2}- calls\.0\.tool:/);
  });

  it('prints help, version and the rule list', async () => {
    expect((await run(['--help'])).stdout).toContain('Usage:');
    expect((await run(['--version'])).stdout).toBe('0.1.0');
    expect((await run(['--list-rules'])).stdout).toContain('response-inline-binary');
  });
});
