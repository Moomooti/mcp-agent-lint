import { describe, expect, it } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { lintTools } from '../src/lint.js';
import { annotations, paramDescription, toolCount, toolDescription, toolDescriptionLength, toolName } from '../src/rules/toolRules.js';
import { DEFAULT_OPTIONS } from '../src/rules/types.js';

const GOOD_DESCRIPTION = 'Shows the caller status in the room, including level and coins.';

function tool(overrides: Partial<Tool> = {}): Tool {
  return {
    name: 'check_status',
    description: GOOD_DESCRIPTION,
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    ...overrides,
  };
}

describe('tool-name', () => {
  it.each(['check_status', 'get-user', 'Tool9', 'a'.repeat(64)])('accepts %s', (name) => {
    expect(toolName.check([tool({ name })], DEFAULT_OPTIONS)).toEqual([]);
  });

  it.each(['throw poop!', 'get.user', 'ㅋㅋ', 'a'.repeat(65), ''])('rejects "%s"', (name) => {
    expect(toolName.check([tool({ name })], DEFAULT_OPTIONS)).toHaveLength(1);
  });
});

describe('tool-description', () => {
  it('flags a missing description', () => {
    const [f] = toolDescription.check([tool({ description: undefined })], DEFAULT_OPTIONS);
    expect(f?.message).toMatch(/No description/);
  });

  it('flags a whitespace-only description as missing', () => {
    expect(toolDescription.check([tool({ description: '   ' })], DEFAULT_OPTIONS)[0]?.message).toMatch(/No description/);
  });

  it('flags a description shorter than the minimum', () => {
    const [f] = toolDescription.check([tool({ description: 'Throws poop.' })], DEFAULT_OPTIONS);
    expect(f?.message).toMatch(/12 chars \(min 40\)/);
  });

  it('respects a custom minimum', () => {
    expect(toolDescription.check([tool({ description: 'Throws poop.' })], { ...DEFAULT_OPTIONS, minDescriptionLength: 10 })).toEqual([]);
  });

  it('flags descriptions that hosts would truncate', () => {
    expect(toolDescriptionLength.check([tool({ description: 'x'.repeat(1025) })], DEFAULT_OPTIONS)).toHaveLength(1);
    expect(toolDescriptionLength.check([tool({ description: 'x'.repeat(1024) })], DEFAULT_OPTIONS)).toEqual([]);
  });
});

describe('param-description', () => {
  it('finds undocumented parameters at any depth, with a path to each', () => {
    const t = tool({
      inputSchema: {
        type: 'object',
        properties: {
          room: { type: 'string' },
          ok: { type: 'string', description: 'Documented.' },
          options: { type: 'object', description: 'Options.', properties: { target: { type: 'string' } } },
          tags: { type: 'array', description: 'Tags.', items: { type: 'object', properties: { label: { type: 'string' } } } },
        },
      },
    });
    const paths = paramDescription.check([t], DEFAULT_OPTIONS).map((f) => f.path);
    expect(paths).toEqual(['input.room', 'input.options.target', 'input.tags[].label']);
  });

  it('passes a tool with no parameters', () => {
    expect(paramDescription.check([tool()], DEFAULT_OPTIONS)).toEqual([]);
  });
});

describe('annotations', () => {
  it('flags a tool with no hints', () => {
    const [f] = annotations.check([tool({ annotations: undefined })], DEFAULT_OPTIONS);
    expect(f?.path).toBe('annotations.readOnlyHint');
  });

  it('explains that a writing tool without destructiveHint counts as destructive', () => {
    const [f] = annotations.check([tool({ annotations: { readOnlyHint: false } })], DEFAULT_OPTIONS);
    expect(f?.message).toMatch(/defaults to true/);
  });

  it.each([{ readOnlyHint: true }, { readOnlyHint: false, destructiveHint: false }, { readOnlyHint: false, destructiveHint: true }])(
    'passes %o',
    (hints) => {
      expect(annotations.check([tool({ annotations: hints })], DEFAULT_OPTIONS)).toEqual([]);
    },
  );
});

describe('tool-count', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => tool({ name: `t${i}` }));

  it('allows up to maxTools', () => {
    expect(toolCount.check(many(20), DEFAULT_OPTIONS)).toEqual([]);
  });

  it('reports once, server-wide, above maxTools', () => {
    const findings = toolCount.check(many(21), DEFAULT_OPTIONS);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.tool).toBeUndefined();
  });
});

describe('lintTools severity config', () => {
  const bad = tool({ name: 'bad name', annotations: undefined });

  it('applies default severities', () => {
    const findings = lintTools([bad]);
    expect(findings.find((f) => f.rule === 'tool-name')?.severity).toBe('error');
    expect(findings.find((f) => f.rule === 'annotations')?.severity).toBe('warn');
  });

  it('can turn a rule off or change its level', () => {
    const findings = lintTools([bad], { severities: { 'tool-name': 'off', annotations: 'error' } });
    expect(findings.some((f) => f.rule === 'tool-name')).toBe(false);
    expect(findings.find((f) => f.rule === 'annotations')?.severity).toBe('error');
  });

  it('rejects an unknown rule id instead of silently ignoring it', () => {
    expect(() => lintTools([bad], { severities: { 'tool-nmae': 'off' } })).toThrow(/Unknown rule "tool-nmae"/);
  });
});
