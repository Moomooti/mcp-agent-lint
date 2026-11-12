import type { RawFinding, ToolRule } from './types.js';

// Most LLM function-calling APIs only accept this shape for function names, and some
// MCP hosts silently drop tools that don't match.
const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

// Several LLM APIs cap function descriptions at 1024 characters; past that, hosts truncate.
const MAX_DESCRIPTION_CHARS = 1_024;

export const toolName: ToolRule = {
  kind: 'tool',
  id: 'tool-name',
  defaultSeverity: 'error',
  summary: 'Tool names must match ^[a-zA-Z0-9_-]{1,64}$ so every LLM API accepts them.',
  check(tools) {
    return tools
      .filter((t) => !TOOL_NAME_PATTERN.test(t.name))
      .map((t) => ({
        tool: t.name,
        message: `Name "${t.name}" does not match ${TOOL_NAME_PATTERN.source}. Many hosts reject or drop it.`,
      }));
  },
};

export const toolDescription: ToolRule = {
  kind: 'tool',
  id: 'tool-description',
  defaultSeverity: 'error',
  summary: 'Every tool needs a description long enough for an agent to decide when to call it.',
  check(tools, { minDescriptionLength }) {
    const findings: RawFinding[] = [];
    for (const tool of tools) {
      const length = tool.description?.trim().length ?? 0;
      if (length === 0) {
        findings.push({ tool: tool.name, message: 'No description. The agent has only the name to guess from.' });
      } else if (length < minDescriptionLength) {
        findings.push({
          tool: tool.name,
          message: `Description is ${length} chars (min ${minDescriptionLength}). Say what it does, when to use it, and what it returns.`,
        });
      }
    }
    return findings;
  },
};

export const toolDescriptionLength: ToolRule = {
  kind: 'tool',
  id: 'tool-description-length',
  defaultSeverity: 'warn',
  summary: `Descriptions over ${MAX_DESCRIPTION_CHARS} chars get truncated by some hosts and cost context on every turn.`,
  check(tools) {
    return tools
      .filter((t) => (t.description?.length ?? 0) > MAX_DESCRIPTION_CHARS)
      .map((t) => ({
        tool: t.name,
        message: `Description is ${t.description?.length ?? 0} chars (max ${MAX_DESCRIPTION_CHARS}). Move detail into parameter descriptions.`,
      }));
  },
};

interface JsonSchemaNode {
  description?: unknown;
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode | JsonSchemaNode[];
}

/** Walks object properties and array items, yielding every named parameter with its path. */
function* walkProperties(node: JsonSchemaNode, path: string): Generator<{ path: string; node: JsonSchemaNode }> {
  for (const [name, child] of Object.entries(node.properties ?? {})) {
    const childPath = `${path}.${name}`;
    yield { path: childPath, node: child };
    yield* walkProperties(child, childPath);
  }
  const items = Array.isArray(node.items) ? node.items : node.items ? [node.items] : [];
  for (const item of items) yield* walkProperties(item, `${path}[]`);
}

export const paramDescription: ToolRule = {
  kind: 'tool',
  id: 'param-description',
  defaultSeverity: 'error',
  summary: 'Every input parameter (including nested ones) needs a description.',
  check(tools) {
    const findings: RawFinding[] = [];
    for (const tool of tools) {
      for (const { path, node } of walkProperties(tool.inputSchema as JsonSchemaNode, 'input')) {
        if (typeof node.description !== 'string' || node.description.trim() === '') {
          findings.push({
            tool: tool.name,
            path,
            message: `Parameter "${path.replace(/^input\./, '')}" has no description, so the agent has to guess its format and meaning.`,
          });
        }
      }
    }
    return findings;
  },
};

export const annotations: ToolRule = {
  kind: 'tool',
  id: 'annotations',
  defaultSeverity: 'warn',
  summary: 'Declare readOnlyHint / destructiveHint so hosts know which calls need confirmation.',
  check(tools) {
    const findings: RawFinding[] = [];
    for (const tool of tools) {
      const a = tool.annotations;
      if (a?.readOnlyHint === undefined) {
        findings.push({
          tool: tool.name,
          path: 'annotations.readOnlyHint',
          message: 'readOnlyHint is not set. Hosts must assume the tool changes state.',
        });
      } else if (!a.readOnlyHint && a.destructiveHint === undefined) {
        findings.push({
          tool: tool.name,
          path: 'annotations.destructiveHint',
          message: 'destructiveHint is not set, and per the MCP spec it then defaults to true (destructive).',
        });
      }
    }
    return findings;
  },
};

export const toolCount: ToolRule = {
  kind: 'tool',
  id: 'tool-count',
  defaultSeverity: 'warn',
  summary: 'Too many tools make tool selection worse and fill the context window.',
  check(tools, { maxTools }) {
    if (tools.length <= maxTools) return [];
    return [
      {
        message: `Server exposes ${tools.length} tools (max ${maxTools}). Consider merging related tools or splitting the server.`,
      },
    ];
  },
};

export const toolRules: readonly ToolRule[] = [
  toolName,
  toolDescription,
  toolDescriptionLength,
  paramDescription,
  annotations,
  toolCount,
];
