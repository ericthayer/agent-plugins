#!/usr/bin/env node
// Agrikit hook dispatcher for GitHub Copilot CLI.
//
// Copilot CLI invokes this script from hooks/hooks.json with the Agrikit event
// name as the first argument and the native hook payload (JSON) on stdin.
// Agrikit events are mapped onto native Copilot hook events:
//
//   on_file_open        postToolUse (view)                  -> inject component docs/usage context
//   on_component_create postToolUse (create)                -> ask the agent to run design-token-sync
//   on_pr_open          postToolUse (bash|*create_pull_request) -> ask for a collab consistency check
//   on_skill_start      postToolUse (skill)                 -> audit "skill_invoked", remember pending skill
//   on_skill_complete   agentStop                           -> audit "skill_completed" for pending skills
//
// The script never blocks the agent: every failure path exits 0 with no output.

import fs from 'node:fs';
import path from 'node:path';

const MAX_READ_BYTES = 256 * 1024;
const MAX_CONTEXT_CHARS = 4000;

const componentsDir = normalizeRel(process.env.AGRIKIT_COMPONENTS_DIR || 'src/components');
const auditDirSetting = process.env.AGRIKIT_AUDIT_DIR || '.agrikit/audit';

function normalizeRel(p) {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function toolArgsOf(payload) {
  const args = payload.toolArgs ?? payload.tool_input ?? {};
  return typeof args === 'string' ? parseJson(args, {}) : args || {};
}

function toolResultText(payload) {
  const r = payload.toolResult ?? payload.tool_result ?? {};
  return String(r.textResultForLlm ?? r.text_result_for_llm ?? '');
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function addContext(text) {
  emit({ additionalContext: text.slice(0, MAX_CONTEXT_CHARS) });
}

/** Resolve a path from tool args inside the session cwd; returns null if outside. */
function resolveInCwd(cwd, p) {
  if (!p || typeof p !== 'string') return null;
  const abs = path.resolve(cwd, p);
  const rel = path.relative(cwd, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return { abs, rel: rel.replace(/\\/g, '/') };
}

/**
 * Match `<componentsDir>/<Name>/<file>` and return the component info, or null.
 * Works for nested library roots such as `packages/ui/src/components/<Name>/...`.
 */
function componentInfo(relPath) {
  const marker = `${componentsDir}/`;
  const idx = relPath.startsWith(marker) ? 0 : relPath.indexOf(`/${marker}`);
  if (idx < 0) return null;
  const start = idx === 0 ? marker.length : idx + marker.length + 1;
  const parts = relPath.slice(start).split('/');
  if (parts.length !== 2) return null;
  const [name, file] = parts;
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) return null;
  return { name, file, dir: relPath.slice(0, start) + name };
}

function isComponentSource(info) {
  return (
    info &&
    /\.(tsx|jsx|ts|js|css)$/.test(info.file) &&
    !/\.(test|spec|stories)\.[jt]sx?$/.test(info.file) &&
    info.file !== 'index.ts' &&
    info.file !== 'index.js'
  );
}

function readSmall(abs) {
  try {
    const stat = fs.statSync(abs);
    if (!stat.isFile() || stat.size > MAX_READ_BYTES) return null;
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

// --- on_file_open ----------------------------------------------------------

function onFileOpen(payload) {
  const cwd = payload.cwd || process.cwd();
  const target = resolveInCwd(cwd, toolArgsOf(payload).path);
  if (!target) return;
  const info = componentInfo(target.rel);
  if (!isComponentSource(info)) return;

  const dirAbs = path.join(cwd, info.dir);
  const candidates = [
    `${info.name}.mdx`,
    'README.md',
    `${info.name}.stories.tsx`,
    `${info.name}.types.ts`,
    `${info.name}.test.tsx`,
  ];
  const found = candidates.filter((f) => fs.existsSync(path.join(dirAbs, f)));

  const lines = [
    `[Agrikit] ${info.name} is an Agrikit component (${info.dir}).`,
  ];
  if (found.length) {
    lines.push(`Related docs and usage examples: ${found.map((f) => `${info.dir}/${f}`).join(', ')}.`);
  } else {
    lines.push('No docs, stories, or types were found next to it; mention this gap if it is relevant.');
  }

  const docFile = found.find((f) => f.endsWith('.mdx') || f === 'README.md');
  if (docFile) {
    const doc = readSmall(path.join(dirAbs, docFile));
    if (doc) lines.push(`Excerpt of ${docFile}:\n${doc.slice(0, 1500)}`);
  }
  lines.push(
    `For full source, variants, and token usage call the agrikit_get_component tool with name "${info.name}". ` +
      'Follow Agrikit conventions (agrikit_get_conventions) when changing this component.',
  );
  addContext(lines.join('\n'));
}

// --- on_component_create ---------------------------------------------------

const RAW_VALUE_PATTERNS = [
  { re: /#[0-9a-fA-F]{3,8}\b/g, label: 'raw hex colour' },
  { re: /\b(?:rgba?|hsla?)\s*\(/g, label: 'raw rgb/hsl colour' },
  { re: /(?<![\w-])(?:[2-9]|\d{2,})px\b/g, label: 'raw px value' },
];

function scanRawValues(text) {
  const findings = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) return;
    for (const { re, label } of RAW_VALUE_PATTERNS) {
      re.lastIndex = 0;
      const m = re.exec(line);
      if (m) findings.push(`line ${i + 1}: ${label} \`${m[0]}\``);
    }
  });
  return findings;
}

function onComponentCreate(payload) {
  const cwd = payload.cwd || process.cwd();
  const args = toolArgsOf(payload);
  const target = resolveInCwd(cwd, args.path);
  if (!target) return;
  const info = componentInfo(target.rel);
  if (!info) return;
  const isMain = new RegExp(`^${info.name}\\.(tsx|jsx)$`).test(info.file);
  const isStyle = /\.css$/.test(info.file);
  if (!isMain && !isStyle) return;

  const text = typeof args.file_text === 'string' ? args.file_text : readSmall(target.abs) || '';
  const findings = scanRawValues(text).slice(0, 10);

  const lines = [
    `[Agrikit] New component file created: ${target.rel}.`,
    `When the ${info.name} scaffold is complete, run the design-token-sync skill in validate mode with scope "${info.dir}" ` +
      'to confirm it only uses existing semantic tokens.',
  ];
  if (findings.length) {
    lines.push(`Possible raw values detected in ${info.file} (replace with --agk-* tokens):`, ...findings.map((f) => `- ${f}`));
  }
  addContext(lines.join('\n'));
}

// --- on_pr_open ------------------------------------------------------------

function onPrOpen(payload) {
  const toolName = String(payload.toolName ?? payload.tool_name ?? '');
  const args = toolArgsOf(payload);
  let opened = false;
  if (/create_pull_request$/.test(toolName)) {
    opened = true;
  } else if (toolName === 'bash' || toolName === 'powershell') {
    const cmd = String(args.command ?? '');
    opened = /\bgh\s+pr\s+create\b/.test(cmd);
  }
  if (!opened) return;

  const url = (toolResultText(payload).match(/https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/) || [])[0];
  addContext(
    `[Agrikit] A pull request was opened${url ? ` (${url})` : ''}. ` +
      'Run a design-engineering consistency check with the agrikit-collab agent: review the changed components and tokens ' +
      '(anatomy, variants, states, token usage via design-token-sync validate, accessibility, docs) and present the report ' +
      'to the user. Ask before posting it as a PR comment.',
  );
}

// --- on_skill_start / on_skill_complete (audit trail) ----------------------

function auditDir(cwd) {
  return path.resolve(cwd, auditDirSetting);
}

function safeId(id) {
  return String(id || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128);
}

function appendAudit(cwd, record) {
  const dir = auditDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'skills.jsonl'), `${JSON.stringify(record)}\n`);
}

function pendingPath(cwd, sessionId) {
  return path.join(auditDir(cwd), `.pending-${safeId(sessionId)}.json`);
}

function isoTime(ts) {
  const d = typeof ts === 'number' ? new Date(ts) : ts ? new Date(ts) : new Date();
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function onSkillStart(payload) {
  const cwd = payload.cwd || process.cwd();
  const args = toolArgsOf(payload);
  const skill = String(args.skill ?? args.name ?? 'unknown');
  const sessionId = payload.sessionId ?? payload.session_id;
  const record = {
    timestamp: isoTime(payload.timestamp),
    event: 'skill_invoked',
    sessionId: sessionId ?? null,
    skill,
    user: process.env.USER || process.env.USERNAME || null,
  };
  appendAudit(cwd, record);

  const file = pendingPath(cwd, sessionId);
  const pending = parseJson(readSmall(file) || '[]', []);
  pending.push({ skill, invokedAt: record.timestamp });
  fs.writeFileSync(file, JSON.stringify(pending));
}

function onSkillComplete(payload) {
  const cwd = payload.cwd || process.cwd();
  const sessionId = payload.sessionId ?? payload.session_id;
  const file = pendingPath(cwd, sessionId);
  const pending = parseJson(readSmall(file) || '[]', []);
  if (!Array.isArray(pending) || pending.length === 0) return;

  const completedAt = isoTime(payload.timestamp);
  for (const p of pending) {
    appendAudit(cwd, {
      timestamp: completedAt,
      event: 'skill_completed',
      sessionId: sessionId ?? null,
      skill: p.skill,
      invokedAt: p.invokedAt,
      durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(p.invokedAt)) || 0,
      transcriptPath: payload.transcriptPath ?? payload.transcript_path ?? null,
      user: process.env.USER || process.env.USERNAME || null,
    });
  }
  fs.rmSync(file, { force: true });
}

// --- main ------------------------------------------------------------------

const handlers = {
  on_file_open: onFileOpen,
  on_component_create: onComponentCreate,
  on_pr_open: onPrOpen,
  on_skill_start: onSkillStart,
  on_skill_complete: onSkillComplete,
};

const event = process.argv[2] || process.env.AGRIKIT_EVENT;
const handler = handlers[event];
if (handler) {
  try {
    handler(parseJson(readStdin(), {}) || {});
  } catch (err) {
    process.stderr.write(`[agrikit] ${event} hook error: ${err && err.message}\n`);
  }
}
process.exit(0);
