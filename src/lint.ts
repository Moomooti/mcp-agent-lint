import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { CallToolResultSchema, McpError, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { allRules, effectiveSeverity, validateSeverities } from './rules/index.js';
import {
  DEFAULT_OPTIONS,
  type Finding,
  type LintOptions,
  type ProbeResult,
  type ResponseRule,
  type SeveritySetting,
  type ToolRule,
} from './rules/types.js';
import { planProbe, type ProbeFile } from './probe.js';

export interface LintConfig {
  options?: Partial<LintOptions>;
  /** Per-rule overrides, e.g. `{ 'tool-count': 'off', annotations: 'error' }`. */
  severities?: Record<string, SeveritySetting>;
}

export interface LintServerConfig extends LintConfig {
  probe?: ProbeFile;
  checkLinks?: boolean;
  allowDestructive?: boolean;
  fetch?: typeof globalThis.fetch;
}

export interface Report {
  server?: { name: string; version: string };
  toolCount: number;
  probeCount: number;
  findings: Finding[];
  errorCount: number;
  warningCount: number;
}

function resolve(config: LintConfig): { options: LintOptions; severities: Record<string, SeveritySetting> } {
  const severities = config.severities ?? {};
  validateSeverities(severities);
  return { options: { ...DEFAULT_OPTIONS, ...config.options }, severities };
}

/** Static checks on a `tools/list` result. Pure, so it also works on a saved tools.json. */
export function lintTools(tools: readonly Tool[], config: LintConfig = {}): Finding[] {
  const { options, severities } = resolve(config);
  const findings: Finding[] = [];
  for (const rule of allRules.filter((r): r is ToolRule => r.kind === 'tool')) {
    const severity = effectiveSeverity(rule, severities);
    if (severity === 'off') continue;
    for (const f of rule.check(tools, options)) findings.push({ rule: rule.id, severity, ...f });
  }
  return findings;
}

/** Checks on real `tools/call` results. */
export async function lintResponses(
  probes: readonly ProbeResult[],
  config: LintConfig & { checkLinks?: boolean; fetch?: typeof globalThis.fetch } = {},
): Promise<Finding[]> {
  const { options, severities } = resolve(config);
  const ctx = { checkLinks: config.checkLinks ?? false, fetch: config.fetch ?? globalThis.fetch };
  const findings: Finding[] = [];
  for (const [i, probe] of probes.entries()) {
    for (const rule of allRules.filter((r): r is ResponseRule => r.kind === 'response')) {
      const severity = effectiveSeverity(rule, severities);
      if (severity === 'off') continue;
      for (const f of await rule.check(probe, options, ctx)) {
        findings.push({
          rule: rule.id,
          severity,
          tool: probe.tool,
          path: f.path ? `probe[${i}].${f.path}` : `probe[${i}]`,
          message: f.message,
        });
      }
    }
  }
  return findings;
}

async function listAllTools(client: Client): Promise<Tool[]> {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

/**
 * Servers report bad calls two ways: an `isError` result, or a JSON-RPC error that makes
 * `callTool` throw. Both mean the same thing to an agent, so fold the second into the first.
 */
async function callAsResult(client: Client, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    return CallToolResultSchema.parse(await client.callTool({ name, arguments: args }, CallToolResultSchema));
  } catch (err) {
    if (!(err instanceof McpError)) throw err;
    return { isError: true, content: [{ type: 'text', text: err.message }] };
  }
}

const ORDER = { error: 0, warn: 1 } as const;

function sortFindings(findings: Finding[]): Finding[] {
  return findings.sort(
    (a, b) =>
      (a.tool ?? '').localeCompare(b.tool ?? '') ||
      ORDER[a.severity] - ORDER[b.severity] ||
      a.rule.localeCompare(b.rule) ||
      (a.path ?? '').localeCompare(b.path ?? ''),
  );
}

/** Lints a connected server: lists its tools, optionally runs the probe calls, applies every rule. */
export async function lintServer(client: Client, config: LintServerConfig = {}): Promise<Report> {
  resolve(config); // fail on bad rule ids before touching the server
  const tools = await listAllTools(client);
  const findings = lintTools(tools, config);

  const probes: ProbeResult[] = [];
  if (config.probe) {
    for (const call of planProbe(config.probe, tools, config.allowDestructive ?? false)) {
      probes.push({
        tool: call.tool,
        arguments: call.arguments,
        expectError: call.expectError,
        result: await callAsResult(client, call.tool, call.arguments),
      });
    }
    findings.push(...(await lintResponses(probes, config)));
  }

  const info = client.getServerVersion();
  return {
    ...(info ? { server: { name: info.name, version: info.version } } : {}),
    toolCount: tools.length,
    probeCount: probes.length,
    findings: sortFindings(findings),
    errorCount: findings.filter((f) => f.severity === 'error').length,
    warningCount: findings.filter((f) => f.severity === 'warn').length,
  };
}
