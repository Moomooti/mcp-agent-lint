import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

export type Severity = 'error' | 'warn';
export type SeveritySetting = Severity | 'off';

export interface Finding {
  rule: string;
  severity: Severity;
  /** Tool the finding is about. Absent for server-wide findings (e.g. too many tools). */
  tool?: string;
  /** Dotted path inside the tool, e.g. `inputSchema.properties.room_code`. */
  path?: string;
  message: string;
}

/** A finding as a rule reports it, before the configured severity is attached. */
export type RawFinding = Omit<Finding, 'rule' | 'severity'>;

export interface LintOptions {
  /** Minimum length for a tool description to count as "real". */
  minDescriptionLength: number;
  /** More tools than this makes tool selection noticeably worse for most agents. */
  maxTools: number;
  /** Response text above this many characters is flagged as too large for an agent turn. */
  maxResponseChars: number;
}

export const DEFAULT_OPTIONS: LintOptions = {
  minDescriptionLength: 40,
  maxTools: 20,
  maxResponseChars: 4_000,
};

/** Rules that only look at what `tools/list` returns. Pure: no network, no side effects. */
export interface ToolRule {
  kind: 'tool';
  id: string;
  defaultSeverity: Severity;
  summary: string;
  check(tools: readonly Tool[], options: LintOptions): RawFinding[];
}

export interface ProbeResult {
  tool: string;
  arguments: Record<string, unknown>;
  expectError: boolean;
  result: CallToolResult;
}

export interface ResponseContext {
  /** Whether rules may make network requests (only the link checker does). */
  checkLinks: boolean;
  /** Injected so tests never hit the network. */
  fetch: typeof globalThis.fetch;
}

/** Rules that look at real `tools/call` responses, collected from a probe file. */
export interface ResponseRule {
  kind: 'response';
  id: string;
  defaultSeverity: Severity;
  summary: string;
  check(probe: ProbeResult, options: LintOptions, ctx: ResponseContext): RawFinding[] | Promise<RawFinding[]>;
}

export type Rule = ToolRule | ResponseRule;
