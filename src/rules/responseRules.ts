import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { RawFinding, ResponseRule } from './types.js';

type ContentBlock = CallToolResult['content'][number];

const DATA_URI = /data:[\w.+-]+\/[\w.+-]+;base64,/i;
// A long unbroken run of base64 alphabet. Real prose, ids and URLs essentially never reach this.
const BASE64_RUN = /[A-Za-z0-9+/]{512,}={0,2}/g;

/** Encoded binary mixes upper, lower and digits; a run like "xxxx..." or a hex hash does not. */
function looksLikeBase64(text: string): boolean {
  return (text.match(BASE64_RUN) ?? []).some((run) => /[A-Z]/.test(run) && /[a-z]/.test(run) && /[0-9]/.test(run));
}
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/g;

/** URLs in prose usually end a sentence or clause; that trailing punctuation is not part of the link. */
export function extractUrls(text: string): string[] {
  return (text.match(URL_PATTERN) ?? []).map((u) => u.replace(/[.,;:!?]+$/, ''));
}

function textOf(block: ContentBlock): string {
  return block.type === 'text' ? block.text : '';
}

export const responseInlineBinary: ResponseRule = {
  kind: 'response',
  id: 'response-inline-binary',
  defaultSeverity: 'error',
  summary:
    'Do not inline images/audio or base64 in tool results; agent answer-generation steps can fail on them. Return a URL instead.',
  check({ result }) {
    const findings: RawFinding[] = [];
    result.content.forEach((block, i) => {
      const path = `content[${i}]`;
      if (block.type === 'image' || block.type === 'audio') {
        findings.push({
          path,
          message: `Returns an inline ${block.type} block (${block.data.length.toLocaleString('en-US')} base64 chars). Serve it by URL and put the URL in text.`,
        });
      } else if (block.type === 'resource' && 'blob' in block.resource) {
        findings.push({ path, message: 'Returns an embedded binary resource (blob). Link to it instead.' });
      } else if (DATA_URI.test(textOf(block))) {
        findings.push({ path, message: 'Text contains a data: URI with base64 payload.' });
      } else if (looksLikeBase64(textOf(block))) {
        findings.push({ path, message: 'Text contains a long base64-looking run (512+ chars).' });
      }
    });
    return findings;
  },
};

export const responseSize: ResponseRule = {
  kind: 'response',
  id: 'response-size',
  defaultSeverity: 'warn',
  summary: 'Keep tool results small; every character is read by the agent on every call.',
  check({ result }, { maxResponseChars }) {
    const total = result.content.reduce((sum, block) => sum + textOf(block).length, 0);
    if (total <= maxResponseChars) return [];
    return [
      {
        message: `Text response is ${total.toLocaleString('en-US')} chars (max ${maxResponseChars.toLocaleString('en-US')}). Summarize, paginate, or return only what the agent needs.`,
      },
    ];
  },
};

export const responseEmpty: ResponseRule = {
  kind: 'response',
  id: 'response-empty',
  defaultSeverity: 'warn',
  summary: 'A result with no text leaves the agent nothing to tell the user.',
  check({ result }) {
    const hasText = result.content.some((b) => textOf(b).trim() !== '');
    const hasStructured = result.structuredContent !== undefined;
    return hasText || hasStructured ? [] : [{ message: 'Response has no text content.' }];
  },
};

export const responseUnexpectedError: ResponseRule = {
  kind: 'response',
  id: 'response-unexpected-error',
  defaultSeverity: 'error',
  summary: 'A probe call failed (or succeeded) when the probe file said it should not.',
  check({ result, expectError }) {
    const isError = result.isError === true;
    if (isError === expectError) return [];
    const detail = result.content.map(textOf).join(' ').trim().slice(0, 200);
    return [
      {
        message: expectError
          ? 'Expected an error result, but the call succeeded.'
          : `Call returned isError${detail ? `: ${detail}` : '.'}`,
      },
    ];
  },
};

export const responseBrokenLink: ResponseRule = {
  kind: 'response',
  id: 'response-broken-link',
  defaultSeverity: 'error',
  summary: 'Links in tool results must resolve; the agent will hand them to the user as-is. (Runs with --check-links.)',
  async check({ result }, _options, { checkLinks, fetch }) {
    if (!checkLinks) return [];
    const urls = new Set(result.content.flatMap((b) => extractUrls(textOf(b))));
    const findings: RawFinding[] = [];
    await Promise.all(
      [...urls].map(async (url) => {
        try {
          const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(10_000) });
          await res.body?.cancel();
          if (!res.ok) findings.push({ message: `Link returns HTTP ${res.status}: ${url}` });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          findings.push({ message: `Link is unreachable (${reason}): ${url}` });
        }
      }),
    );
    return findings.sort((a, b) => a.message.localeCompare(b.message));
  },
};

export const responseRules: readonly ResponseRule[] = [
  responseInlineBinary,
  responseSize,
  responseEmpty,
  responseUnexpectedError,
  responseBrokenLink,
];
