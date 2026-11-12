import { describe, expect, it } from 'vitest';
import { lintServer } from '../src/lint.js';
import { ProbeError } from '../src/probe.js';
import { connectFixture, fakeFetch } from './helpers.js';

describe('lintServer on a well-behaved server', () => {
  it('finds nothing, including in probed responses and their links', async () => {
    const client = await connectFixture('good');
    const report = await lintServer(client, {
      checkLinks: true,
      fetch: fakeFetch(),
      probe: {
        calls: [
          { tool: 'check_status', arguments: { room_code: 'r', nickname: 'a' }, expectError: false },
          { tool: 'throw_poop', arguments: { room_code: 'r', nickname: 'a', target: 'b' }, expectError: false },
          { tool: 'throw_poop', arguments: { room_code: '', nickname: 'a' }, expectError: true },
        ],
      },
    });
    expect(report).toMatchObject({
      server: { name: 'fixture-good', version: '1.0.0' },
      toolCount: 3,
      probeCount: 3,
      findings: [],
      errorCount: 0,
      warningCount: 0,
    });
  });

  it('follows tools/list pagination', async () => {
    const client = await connectFixture('good', { pageSize: 1 });
    expect((await lintServer(client)).toolCount).toBe(3);
  });
});

describe('lintServer on a badly-behaved server', () => {
  it('reports every static problem, sorted by tool then severity', async () => {
    const report = await lintServer(await connectFixture('bad'));
    expect(report.findings.map((f) => `${f.tool ?? ''} ${f.severity} ${f.rule} ${f.path ?? ''}`.trim())).toEqual([
      'getStatus error tool-description',
      'getStatus warn annotations annotations.destructiveHint',
      'throw poop! error param-description input.options',
      'throw poop! error param-description input.options.target',
      'throw poop! error param-description input.room',
      'throw poop! error param-description input.tags',
      'throw poop! error param-description input.tags[].label',
      'throw poop! error tool-description',
      'throw poop! error tool-name',
      'throw poop! warn annotations annotations.readOnlyHint',
    ]);
    expect(report.errorCount).toBe(8);
    expect(report.warningCount).toBe(2);
  });

  it('catches the inline image and the oversized response once probing is allowed', async () => {
    const report = await lintServer(await connectFixture('bad'), {
      allowDestructive: true,
      severities: { 'param-description': 'off', 'tool-description': 'off', 'tool-name': 'off', annotations: 'off' },
      probe: {
        calls: [
          { tool: 'throw poop!', arguments: {}, expectError: false },
          { tool: 'getStatus', arguments: {}, expectError: false },
        ],
      },
    });
    expect(report.findings.map((f) => [f.tool, f.rule, f.path])).toEqual([
      ['getStatus', 'response-size', 'probe[1]'],
      ['throw poop!', 'response-inline-binary', 'probe[0].content[1]'],
    ]);
  });
});

describe('probe safety', () => {
  it('refuses to call tools that may be destructive unless allowed', async () => {
    const client = await connectFixture('good');
    const run = lintServer(client, {
      probe: { calls: [{ tool: 'reset_room', arguments: { room_code: 'r' }, expectError: false }] },
    });
    await expect(run).rejects.toThrow(ProbeError);
    await expect(run).rejects.toThrow(/reset_room.*--allow-destructive/s);
  });

  it('treats a writing tool without destructiveHint as destructive (MCP spec default)', async () => {
    const run = lintServer(await connectFixture('bad'), { probe: { calls: [{ tool: 'getStatus', arguments: {}, expectError: false }] } });
    await expect(run).rejects.toThrow(/getStatus/);
  });

  it('rejects calls to tools the server does not have, before calling anything', async () => {
    const run = lintServer(await connectFixture('good'), {
      probe: { calls: [{ tool: 'check_stauts', arguments: {}, expectError: false }] },
    });
    await expect(run).rejects.toThrow(/check_stauts.*Available: check_status, throw_poop, reset_room/s);
  });

  it('turns a JSON-RPC error from the server into an error result instead of crashing', async () => {
    const report = await lintServer(await connectFixture('good'), {
      probe: {
        calls: [{ tool: 'throw_poop', arguments: { room_code: 'r', nickname: 'a', target: '__protocol_error__' }, expectError: false }],
      },
    });
    expect(report.findings).toEqual([
      expect.objectContaining({
        rule: 'response-unexpected-error',
        message: expect.stringMatching(/isError: .*target must be a nickname/) as string,
      }),
    ]);
  });

  it('reports a server-side isError the probe did not expect', async () => {
    const report = await lintServer(await connectFixture('good'), {
      probe: { calls: [{ tool: 'throw_poop', arguments: { room_code: '', nickname: 'a' }, expectError: false }] },
    });
    expect(report.findings).toEqual([
      expect.objectContaining({ rule: 'response-unexpected-error', message: 'Call returned isError: room_code is required' }),
    ]);
  });
});
