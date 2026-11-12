#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { connect, ConnectionError, type Target } from './connect.js';
import { colorStyle, formatPretty, plainStyle } from './format/pretty.js';
import { lintServer } from './lint.js';
import { loadProbeFile, ProbeError } from './probe.js';
import { allRules, UnknownRuleError } from './rules/index.js';
import { DEFAULT_OPTIONS, type LintOptions, type SeveritySetting } from './rules/types.js';
import { VERSION } from './version.js';


export const EXIT = { ok: 0, lintFailed: 1, usage: 2 } as const;

const HELP = `mcp-agent-lint ${VERSION}
Lint an MCP server the way an AI agent experiences it.

Usage:
  mcp-agent-lint <url> [options]                 Streamable HTTP server
  mcp-agent-lint --stdio [options] -- <cmd...>   stdio server started by <cmd>

Options:
  -H, --header "Name: value"     HTTP header (repeatable), e.g. for auth
  -p, --probe <file>             JSON file of tool calls to make, enabling response rules
      --allow-destructive        Let the probe call tools not marked readOnly / non-destructive
      --check-links              Fetch every URL found in probe responses
  -r, --rule <id>=<level>        Override a rule: off | warn | error (repeatable)
      --min-description-length <n>   default ${DEFAULT_OPTIONS.minDescriptionLength}
      --max-tools <n>                default ${DEFAULT_OPTIONS.maxTools}
      --max-response-chars <n>       default ${DEFAULT_OPTIONS.maxResponseChars}
      --max-warnings <n>         Fail if there are more warnings than this (default: no limit)
  -f, --format <pretty|json>     Output format (default: pretty)
      --timeout <ms>             Connection timeout (default: 30000)
      --list-rules               Print all rules and exit
  -h, --help                     Show this help
  -v, --version                  Show version

Exit codes: 0 no errors · 1 lint errors (or too many warnings) · 2 usage or connection problem

Examples:
  mcp-agent-lint http://localhost:3000/mcp
  mcp-agent-lint http://localhost:3000/mcp --probe probe.json --check-links
  mcp-agent-lint --stdio -- node dist/server.js
`;

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  color: boolean;
  fetch?: typeof globalThis.fetch;
}

class UsageError extends Error {}

function parseIntOption(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new UsageError(`--${name} must be a non-negative integer, got "${value}"`);
  return n;
}

function parseRuleOverrides(values: string[]): Record<string, SeveritySetting> {
  const out: Record<string, SeveritySetting> = {};
  for (const v of values) {
    const match = /^([a-z0-9-]+)=(off|warn|error)$/.exec(v);
    if (!match?.[1] || !match[2]) throw new UsageError(`--rule expects <id>=off|warn|error, got "${v}"`);
    out[match[1]] = match[2] as SeveritySetting;
  }
  return out;
}

function parseHeaders(values: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of values) {
    const i = v.indexOf(':');
    if (i <= 0) throw new UsageError(`--header expects "Name: value", got "${v}"`);
    out[v.slice(0, i).trim()] = v.slice(i + 1).trim();
  }
  return out;
}

function listRules(): string {
  const width = Math.max(...allRules.map((r) => r.id.length));
  const rows = allRules.map(
    (r) => `${r.id.padEnd(width)}  ${r.defaultSeverity.padEnd(5)}  ${(r.kind === 'tool' ? 'tools/list' : 'probe').padEnd(10)}  ${r.summary}`,
  );
  return [`${'rule'.padEnd(width)}  level  checks      what it means`, ...rows].join('\n');
}

export async function main(argv: string[], io: Io): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        stdio: { type: 'boolean', default: false },
        header: { type: 'string', short: 'H', multiple: true, default: [] },
        probe: { type: 'string', short: 'p' },
        'allow-destructive': { type: 'boolean', default: false },
        'check-links': { type: 'boolean', default: false },
        rule: { type: 'string', short: 'r', multiple: true, default: [] },
        'min-description-length': { type: 'string' },
        'max-tools': { type: 'string' },
        'max-response-chars': { type: 'string' },
        'max-warnings': { type: 'string' },
        format: { type: 'string', short: 'f', default: 'pretty' },
        timeout: { type: 'string' },
        'list-rules': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });

    const info = values.help ? HELP : values.version ? VERSION : values['list-rules'] ? listRules() : undefined;
    if (info !== undefined) {
      io.stdout(info);
      return EXIT.ok;
    }

    if (values.format !== 'pretty' && values.format !== 'json') {
      throw new UsageError(`--format must be "pretty" or "json", got "${values.format}"`);
    }

    let target: Target;
    if (values.stdio) {
      const [command, ...args] = positionals;
      if (!command) throw new UsageError('--stdio needs a command after "--", e.g. --stdio -- node server.js');
      target = { kind: 'stdio', command, args };
    } else {
      if (positionals.length !== 1 || !positionals[0]) throw new UsageError('Give exactly one server URL, or use --stdio -- <cmd>.');
      target = { kind: 'http', url: positionals[0], headers: parseHeaders(values.header) };
    }

    const options: Partial<LintOptions> = {};
    const minDesc = parseIntOption('min-description-length', values['min-description-length']);
    const maxTools = parseIntOption('max-tools', values['max-tools']);
    const maxChars = parseIntOption('max-response-chars', values['max-response-chars']);
    if (minDesc !== undefined) options.minDescriptionLength = minDesc;
    if (maxTools !== undefined) options.maxTools = maxTools;
    if (maxChars !== undefined) options.maxResponseChars = maxChars;
    const maxWarnings = parseIntOption('max-warnings', values['max-warnings']);
    const timeoutMs = parseIntOption('timeout', values.timeout) ?? 30_000;
    const severities = parseRuleOverrides(values.rule);
    const probe = values.probe ? await loadProbeFile(values.probe) : undefined;

    const connection = await connect(target, { timeoutMs });
    try {
      const report = await lintServer(connection.client, {
        options,
        severities,
        checkLinks: values['check-links'],
        allowDestructive: values['allow-destructive'],
        ...(probe ? { probe } : {}),
        ...(io.fetch ? { fetch: io.fetch } : {}),
      });
      io.stdout(values.format === 'json' ? JSON.stringify(report, null, 2) : formatPretty(report, io.color ? colorStyle : plainStyle));

      if (report.errorCount > 0) return EXIT.lintFailed;
      if (maxWarnings !== undefined && report.warningCount > maxWarnings) {
        io.stderr(`Too many warnings: ${report.warningCount} (max ${maxWarnings}).`);
        return EXIT.lintFailed;
      }
      return EXIT.ok;
    } finally {
      await connection.close();
    }
  } catch (err) {
    if (
      err instanceof UsageError ||
      err instanceof ProbeError ||
      err instanceof ConnectionError ||
      err instanceof UnknownRuleError ||
      (err instanceof TypeError && 'code' in err && String(err.code).startsWith('ERR_PARSE_ARGS'))
    ) {
      io.stderr(`mcp-agent-lint: ${err.message}\nRun with --help for usage.`);
      return EXIT.usage;
    }
    throw err;
  }
}

// Run only when executed directly (also through the npm bin symlink), not when imported by tests.
const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const color = process.stdout.isTTY && !process.env.NO_COLOR;
  const exitCode = await main(process.argv.slice(2), {
    stdout: (t) => process.stdout.write(`${t}\n`),
    stderr: (t) => process.stderr.write(`${t}\n`),
    color,
  });
  process.exitCode = exitCode;
}
