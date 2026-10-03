#!/usr/bin/env node
// Agrikit MCP server (stdio, zero dependencies).
//
// Exposes the project's Agrikit component library, design tokens, and the
// Agrikit conventions to Copilot agents. Messages are newline-delimited
// JSON-RPC 2.0 as defined by the MCP stdio transport.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const SERVER_INFO = { name: 'agrikit', version: '1.0.0' };
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_FILE_BYTES = 64 * 1024;
const COMPONENT_NAME_RE = /^[A-Z][A-Za-z0-9]*$/;

const here = path.dirname(fileURLToPath(import.meta.url));
const conventionsPath = path.resolve(here, '../../docs/conventions.md');

const config = {
  componentsDir: process.env.AGRIKIT_COMPONENTS_DIR || 'src/components',
  tokensPath: process.env.AGRIKIT_TOKENS_PATH || 'tokens/tokens.json',
  tokensCssPath: process.env.AGRIKIT_TOKENS_CSS_PATH || 'src/styles/tokens.css',
};

function projectRoot(args) {
  return path.resolve(args?.projectRoot || process.env.AGRIKIT_PROJECT_ROOT || process.cwd());
}

/** Resolve `rel` under `root`, refusing paths that escape it. */
function within(root, rel) {
  const abs = path.resolve(root, rel);
  const r = path.relative(root, abs);
  if (r.startsWith('..') || path.isAbsolute(r)) throw new Error(`Path escapes project root: ${rel}`);
  return abs;
}

function readText(abs) {
  const stat = fs.statSync(abs);
  if (!stat.isFile()) throw new Error(`Not a file: ${abs}`);
  const buf = Buffer.alloc(Math.min(stat.size, MAX_FILE_BYTES));
  const fd = fs.openSync(abs, 'r');
  try {
    fs.readSync(fd, buf, 0, buf.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  const text = buf.toString('utf8');
  return stat.size > MAX_FILE_BYTES ? `${text}\n/* …truncated (${stat.size} bytes) */` : text;
}

// --- tools -----------------------------------------------------------------

function listComponents(args) {
  const root = projectRoot(args);
  const dir = within(root, config.componentsDir);
  if (!fs.existsSync(dir)) {
    return { componentsDir: config.componentsDir, components: [], note: 'Components directory not found.' };
  }
  const components = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && COMPONENT_NAME_RE.test(d.name))
    .map((d) => {
      const files = fs.readdirSync(path.join(dir, d.name));
      const has = (suffix) => files.includes(`${d.name}${suffix}`);
      return {
        name: d.name,
        path: path.posix.join(config.componentsDir.replace(/\\/g, '/'), d.name),
        files,
        hasTypes: has('.types.ts'),
        hasStyles: has('.module.css'),
        hasStories: has('.stories.tsx'),
        hasTests: has('.test.tsx'),
        hasDocs: has('.mdx') || files.includes('README.md'),
      };
    });
  return { componentsDir: config.componentsDir, count: components.length, components };
}

function extractUnion(source, typeName) {
  const m = source.match(new RegExp(`type\\s+${typeName}\\s*=\\s*([^;]+);`));
  if (!m) return null;
  return [...m[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((x) => x[1] ?? x[2]);
}

function getComponent(args) {
  const name = String(args?.name || '');
  if (!COMPONENT_NAME_RE.test(name)) throw new Error('`name` must be a PascalCase component name.');
  const root = projectRoot(args);
  const dir = within(root, path.join(config.componentsDir, name));
  if (!fs.existsSync(dir)) throw new Error(`Component not found: ${name}`);

  const files = {};
  for (const f of fs.readdirSync(dir)) {
    const abs = path.join(dir, f);
    if (fs.statSync(abs).isFile() && /\.(tsx?|jsx?|css|mdx|md)$/.test(f)) files[f] = readText(abs);
  }
  const typesSrc = files[`${name}.types.ts`] || files[`${name}.tsx`] || '';
  const allCss = Object.entries(files)
    .filter(([f]) => f.endsWith('.css'))
    .map(([, t]) => t)
    .join('\n');
  const tokensUsed = [...new Set([...allCss.matchAll(/var\(\s*(--agk-[\w-]+)/g)].map((m) => m[1]))].sort();
  return {
    name,
    variants: extractUnion(typesSrc, `${name}Variant`),
    sizes: extractUnion(typesSrc, `${name}Size`),
    tokensUsed,
    files,
  };
}

function flattenTokens(node, prefix = [], out = []) {
  if (node && typeof node === 'object' && '$value' in node) {
    const name = prefix.join('.');
    const value = node.$value;
    const alias = typeof value === 'string' && /^\{[^}]+\}$/.test(value) ? value.slice(1, -1) : null;
    out.push({
      name,
      type: node.$type ?? null,
      value,
      aliasOf: alias,
      cssVar: `--agk-${prefix.join('-')}`,
      description: node.$description ?? null,
      deprecated: Boolean(node.$extensions?.agrikit?.deprecated),
    });
    return out;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (!k.startsWith('$')) flattenTokens(v, [...prefix, k], out);
    }
  }
  return out;
}

function getTokens(args) {
  const root = projectRoot(args);
  const format = args?.format === 'css' ? 'css' : 'json';
  if (format === 'css') {
    const abs = within(root, config.tokensCssPath);
    if (!fs.existsSync(abs)) throw new Error(`Token CSS not found: ${config.tokensCssPath}`);
    const css = readText(abs);
    const vars = [...css.matchAll(/(--agk-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => ({ cssVar: m[1], value: m[2].trim() }));
    return { source: config.tokensCssPath, count: vars.length, tokens: vars };
  }
  const abs = within(root, config.tokensPath);
  if (!fs.existsSync(abs)) throw new Error(`Token source not found: ${config.tokensPath}`);
  let tokens = flattenTokens(JSON.parse(fs.readFileSync(abs, 'utf8')));
  if (args?.category) tokens = tokens.filter((t) => t.name.split('.')[0] === args.category);
  const names = new Set(tokens.map((t) => t.name));
  const unresolved = tokens.filter((t) => t.aliasOf && !names.has(t.aliasOf) && !args?.category).map((t) => t.name);
  return { source: config.tokensPath, count: tokens.length, unresolvedAliases: unresolved, tokens };
}

function getConventions() {
  return fs.readFileSync(conventionsPath, 'utf8');
}

const projectRootSchema = {
  type: 'string',
  description: 'Absolute path to the project root. Defaults to AGRIKIT_PROJECT_ROOT or the server working directory.',
};

const TOOLS = [
  {
    name: 'agrikit_get_conventions',
    description: 'Return the Agrikit conventions: component layout, naming, tokens, hooks, accessibility, and agentic harnessing rules.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: getConventions,
  },
  {
    name: 'agrikit_list_components',
    description: 'List Agrikit components in the project with which convention files (types, styles, stories, tests, docs) each has.',
    inputSchema: { type: 'object', properties: { projectRoot: projectRootSchema }, additionalProperties: false },
    handler: listComponents,
  },
  {
    name: 'agrikit_get_component',
    description: 'Get an Agrikit component: source files, variant and size unions, and the --agk-* tokens its styles use.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'PascalCase component name, e.g. Button' }, projectRoot: projectRootSchema },
      required: ['name'],
      additionalProperties: false,
    },
    handler: getComponent,
  },
  {
    name: 'agrikit_get_tokens',
    description: 'Get Agrikit design tokens from the DTCG JSON source (default) or the generated CSS variables.',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['json', 'css'], description: 'json = DTCG source, css = generated CSS variables' },
        category: { type: 'string', description: 'Top-level category filter for json format, e.g. color, space' },
        projectRoot: projectRootSchema,
      },
      additionalProperties: false,
    },
    handler: getTokens,
  },
];

// --- JSON-RPC over stdio ---------------------------------------------------

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  const reply = (result) => isRequest && send({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => isRequest && send({ jsonrpc: '2.0', id, error: { code, message } });

  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion;
      return reply({
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS.map(({ handler, ...t }) => t) });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return fail(-32602, `Unknown tool: ${params?.name}`);
      try {
        const result = tool.handler(params?.arguments || {});
        const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        return reply({ content: [{ type: 'text', text }], isError: false });
      } catch (err) {
        return reply({ content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true });
      }
    }
    default:
      if (method?.startsWith('notifications/')) return undefined;
      return fail(-32601, `Method not found: ${method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }
  for (const m of Array.isArray(msg) ? msg : [msg]) handle(m);
});
