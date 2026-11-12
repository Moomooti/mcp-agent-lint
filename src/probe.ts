import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * A probe file lists real tool calls to make, so response rules have something to inspect.
 * Calls run in order against the live server - point it at a test instance, not production.
 */
export const probeFileSchema = z.object({
  calls: z
    .array(
      z.object({
        tool: z.string().min(1),
        arguments: z.record(z.string(), z.unknown()).default({}),
        expectError: z.boolean().default(false),
      }),
    )
    .min(1),
});

export type ProbeFile = z.infer<typeof probeFileSchema>;
export type ProbeCall = ProbeFile['calls'][number];

/** A mistake in the probe file or a call that would be unsafe. Reported as a usage error, not a lint finding. */
export class ProbeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProbeError';
  }
}

export async function loadProbeFile(path: string): Promise<ProbeFile> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ProbeError(`Cannot read probe file ${path}: ${reason}`);
  }
  const parsed = probeFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new ProbeError(`Invalid probe file ${path}:\n${issues}`);
  }
  return parsed.data;
}

/** Per the MCP spec, a tool that is not read-only is destructive unless it says otherwise. */
export function isPotentiallyDestructive(tool: Tool): boolean {
  const a = tool.annotations;
  return a?.readOnlyHint !== true && a?.destructiveHint !== false;
}

/** Checks every call before any call is made, so a bad probe file never half-runs. */
export function planProbe(probe: ProbeFile, tools: readonly Tool[], allowDestructive: boolean): ProbeCall[] {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const unknown = probe.calls.filter((c) => !byName.has(c.tool)).map((c) => c.tool);
  if (unknown.length > 0) {
    throw new ProbeError(
      `Probe file calls tools the server does not expose: ${[...new Set(unknown)].join(', ')}. Available: ${[...byName.keys()].join(', ')}`,
    );
  }
  if (!allowDestructive) {
    const destructive = probe.calls.map((c) => byName.get(c.tool)).filter((t): t is Tool => !!t && isPotentiallyDestructive(t));
    if (destructive.length > 0) {
      throw new ProbeError(
        `Probe file calls potentially destructive tools: ${[...new Set(destructive.map((t) => t.name))].join(', ')}.\n` +
          'Run against a test instance and pass --allow-destructive, or remove these calls.',
      );
    }
  }
  return probe.calls;
}
