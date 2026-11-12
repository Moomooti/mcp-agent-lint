import type { Report } from '../lint.js';
import type { Finding } from '../rules/types.js';

export interface Style {
  red(s: string): string;
  yellow(s: string): string;
  dim(s: string): string;
  bold(s: string): string;
  green(s: string): string;
}

const ansi = (open: number, close: number) => (s: string) => `\u001b[${open}m${s}\u001b[${close}m`;

export const colorStyle: Style = {
  red: ansi(31, 39),
  yellow: ansi(33, 39),
  dim: ansi(2, 22),
  bold: ansi(1, 22),
  green: ansi(32, 39),
};

const identity = (s: string) => s;
export const plainStyle: Style = { red: identity, yellow: identity, dim: identity, bold: identity, green: identity };

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Human-readable report, grouped by tool, eslint-style. */
export function formatPretty(report: Report, style: Style = plainStyle): string {
  const lines: string[] = [];
  const server = report.server ? `${report.server.name} ${report.server.version}` : 'server';
  const probes = report.probeCount > 0 ? ` · ${plural(report.probeCount, 'probe call')}` : '';
  lines.push(style.dim(`mcp-agent-lint · ${server} · ${plural(report.toolCount, 'tool')}${probes}`), '');

  const groups = new Map<string, Finding[]>();
  for (const f of report.findings) {
    const key = f.tool ?? '(server)';
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }

  for (const [tool, findings] of groups) {
    lines.push(style.bold(tool));
    for (const f of findings) {
      const sev = f.severity === 'error' ? style.red('error') : style.yellow('warn ');
      const where = f.path ? `${style.dim(f.path)}  ` : '';
      lines.push(`  ${sev}  ${where}${f.message}  ${style.dim(f.rule)}`);
    }
    lines.push('');
  }

  if (report.findings.length === 0) {
    lines.push(style.green('✔ No problems found.'));
  } else {
    const summary = `✖ ${plural(report.errorCount, 'error')}, ${plural(report.warningCount, 'warning')}`;
    lines.push(report.errorCount > 0 ? style.red(summary) : style.yellow(summary));
  }
  return lines.join('\n');
}
