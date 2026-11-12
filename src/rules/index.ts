import { responseRules } from './responseRules.js';
import { toolRules } from './toolRules.js';
import type { Rule, Severity, SeveritySetting } from './types.js';

export const allRules: readonly Rule[] = [...toolRules, ...responseRules];

const RULE_IDS = new Set(allRules.map((r) => r.id));

export class UnknownRuleError extends Error {
  constructor(id: string) {
    super(`Unknown rule "${id}". Run with --list-rules to see all rules.`);
    this.name = 'UnknownRuleError';
  }
}

/** Validates user overrides up front, so a typo in a rule id fails loudly instead of being ignored. */
export function validateSeverities(overrides: Readonly<Record<string, SeveritySetting>>): void {
  for (const id of Object.keys(overrides)) {
    if (!RULE_IDS.has(id)) throw new UnknownRuleError(id);
  }
}

export function effectiveSeverity(
  rule: Rule,
  overrides: Readonly<Record<string, SeveritySetting>>,
): Severity | 'off' {
  return overrides[rule.id] ?? rule.defaultSeverity;
}

export * from './types.js';
export * from './toolRules.js';
export * from './responseRules.js';
