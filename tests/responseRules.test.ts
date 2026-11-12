import { describe, expect, it } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { lintResponses } from '../src/lint.js';
import { extractUrls, responseBrokenLink, responseEmpty, responseInlineBinary, responseSize, responseUnexpectedError } from '../src/rules/responseRules.js';
import { DEFAULT_OPTIONS, type ProbeResult } from '../src/rules/types.js';
import { fakeFetch } from './helpers.js';

const noNetwork = { checkLinks: false, fetch: fakeFetch() };

function probe(result: CallToolResult, expectError = false): ProbeResult {
  return { tool: 'throw_poop', arguments: {}, expectError, result };
}
const text = (t: string): CallToolResult => ({ content: [{ type: 'text', text: t }] });

describe('response-inline-binary', () => {
  it('flags an inline image block - the bug that broke PlayMCP answer generation', () => {
    const result: CallToolResult = {
      content: [
        { type: 'text', text: 'Hit!' },
        { type: 'image', data: 'A'.repeat(2048), mimeType: 'image/jpeg' },
      ],
    };
    const [f] = responseInlineBinary.check(probe(result), DEFAULT_OPTIONS, noNetwork) as { path?: string; message: string }[];
    expect(f?.path).toBe('content[1]');
    expect(f?.message).toMatch(/inline image block \(2,048 base64 chars\)/);
  });

  it('flags inline audio and embedded blobs', () => {
    const result: CallToolResult = {
      content: [
        { type: 'audio', data: 'AAAA', mimeType: 'audio/wav' },
        { type: 'resource', resource: { uri: 'file:///a.bin', blob: 'AAAA' } },
      ],
    };
    expect(responseInlineBinary.check(probe(result), DEFAULT_OPTIONS, noNetwork)).toHaveLength(2);
  });

  it('flags base64 smuggled into text', () => {
    expect(responseInlineBinary.check(probe(text('see data:image/png;base64,iVBORw0KGgo=')), DEFAULT_OPTIONS, noNetwork)).toHaveLength(1);
    expect(responseInlineBinary.check(probe(text(`blob: ${'Ab09+/'.repeat(100)}`)), DEFAULT_OPTIONS, noNetwork)).toHaveLength(1);
  });

  it('does not mistake long non-binary runs for base64', () => {
    const notBinary = text(`${'x'.repeat(6000)}\nsha: ${'0123456789abcdef'.repeat(40)}`);
    expect(responseInlineBinary.check(probe(notBinary), DEFAULT_OPTIONS, noNetwork)).toEqual([]);
  });

  it('does not flag normal text or image URLs', () => {
    const ok = text('💩 Hit friend!\n🖼️ https://example.test/assets/species/12.jpg\nid: 3f2a9c1e-77b0-4d2a-9a51-0c4e2f1b9d10');
    expect(responseInlineBinary.check(probe(ok), DEFAULT_OPTIONS, noNetwork)).toEqual([]);
  });
});

describe('response-size', () => {
  it('counts all text blocks together', () => {
    const result: CallToolResult = { content: [{ type: 'text', text: 'x'.repeat(2500) }, { type: 'text', text: 'y'.repeat(2500) }] };
    expect(responseSize.check(probe(result), DEFAULT_OPTIONS, noNetwork)).toHaveLength(1);
  });

  it('respects maxResponseChars', () => {
    expect(responseSize.check(probe(text('x'.repeat(100))), { ...DEFAULT_OPTIONS, maxResponseChars: 50 }, noNetwork)).toHaveLength(1);
    expect(responseSize.check(probe(text('x'.repeat(4000))), DEFAULT_OPTIONS, noNetwork)).toEqual([]);
  });
});

describe('response-empty', () => {
  it('flags results with no text', () => {
    expect(responseEmpty.check(probe({ content: [] }), DEFAULT_OPTIONS, noNetwork)).toHaveLength(1);
    expect(responseEmpty.check(probe(text('  ')), DEFAULT_OPTIONS, noNetwork)).toHaveLength(1);
  });

  it('accepts structured content without text', () => {
    expect(responseEmpty.check(probe({ content: [], structuredContent: { ok: true } }), DEFAULT_OPTIONS, noNetwork)).toEqual([]);
  });
});

describe('response-unexpected-error', () => {
  it('flags an error the probe did not expect, quoting the server message', () => {
    const [f] = responseUnexpectedError.check(probe({ isError: true, content: [{ type: 'text', text: 'room_code is required' }] }), DEFAULT_OPTIONS, noNetwork) as {
      message: string;
    }[];
    expect(f?.message).toBe('Call returned isError: room_code is required');
  });

  it('flags a success when the probe expected an error', () => {
    expect(responseUnexpectedError.check(probe(text('ok'), true), DEFAULT_OPTIONS, noNetwork)).toHaveLength(1);
  });

  it('passes when expectation matches', () => {
    expect(responseUnexpectedError.check(probe({ isError: true, content: [] }, true), DEFAULT_OPTIONS, noNetwork)).toEqual([]);
  });
});

describe('response-broken-link', () => {
  const links = text('img https://cdn.test/ok.jpg and https://cdn.test/missing.jpg, again https://cdn.test/ok.jpg\nhttps://down.test/x');

  it('does nothing unless link checking is on', async () => {
    expect(await responseBrokenLink.check(probe(links), DEFAULT_OPTIONS, noNetwork)).toEqual([]);
  });

  it('reports non-2xx and unreachable links, each URL once', async () => {
    const fetch = fakeFetch({ 'https://cdn.test/missing.jpg': 404, 'https://down.test/x': -1 });
    const findings = await responseBrokenLink.check(probe(links), DEFAULT_OPTIONS, { checkLinks: true, fetch });
    expect(findings.map((f) => f.message)).toEqual([
      'Link is unreachable (ECONNREFUSED): https://down.test/x',
      'Link returns HTTP 404: https://cdn.test/missing.jpg',
    ]);
  });
});

describe('lintResponses', () => {
  it('attributes findings to the probed tool and call index', async () => {
    const findings = await lintResponses([probe(text('ok')), probe({ content: [] })]);
    expect(findings).toEqual([
      { rule: 'response-empty', severity: 'warn', tool: 'throw_poop', path: 'probe[1]', message: 'Response has no text content.' },
    ]);
  });
});

describe('extractUrls', () => {
  it('drops sentence punctuation stuck to the end of a link', () => {
    expect(extractUrls('see https://a.test/x.jpg, https://a.test/y. and (https://a.test/z)')).toEqual([
      'https://a.test/x.jpg',
      'https://a.test/y',
      'https://a.test/z',
    ]);
  });
});
