# Agrikit — GitHub Copilot CLI plugin

Agrikit bundles everything a mid-level product designer or software engineer
needs to work on the Agrikit component library with GitHub Copilot CLI:
custom agents, skills, hooks, an MCP server, and language server configuration,
in one installable package.

## Install

```shell
# Recommended: from the marketplace in this repository
copilot plugin marketplace add ericthayer/agent-plugins
copilot plugin install agrikit@ericthayer-agent-plugins

# Or directly from a local clone (for plugin development)
copilot plugin install ./agrikit-plugin
```

Check it loaded:

```shell
copilot plugin list   # agrikit (v1.0.0)
copilot skill list    # component-scaffold, design-token-sync, hook-generator, lsp-assist
copilot mcp list      # agrikit (local), figma (http)
copilot lsp list      # agrikit-typescript, agrikit-css
```

In an interactive session, `/agent` lists the three Agrikit agents.

### Requirements

- Node.js 18+ on `PATH` (runs the bundled MCP server and hook scripts; no npm dependencies).
- For LSP features: `npm i -g typescript typescript-language-server vscode-langservers-extracted`.
- For Figma token sync: authenticate the `figma` MCP server when Copilot prompts you (never store Figma tokens in files).

## Structure

```
agrikit-plugin/
├── agents/
│   ├── design.agent.md          # "Sage" – product designers
│   ├── engineering.agent.md     # "Forge" – software engineers
│   └── collab.agent.md          # "Bridge" – design ↔ engineering handoff
├── skills/
│   ├── component-scaffold/SKILL.md
│   ├── design-token-sync/SKILL.md
│   ├── hook-generator/SKILL.md
│   └── lsp-assist/SKILL.md
├── hooks/
│   ├── hooks.json               # Copilot CLI hook configuration
│   └── scripts/agrikit-hooks.mjs# Agrikit event dispatcher
├── mcp/
│   ├── agrikit-mcp.json         # MCP server configuration
│   └── server/index.mjs         # Bundled Agrikit MCP server (stdio)
├── docs/conventions.md          # Single source of truth for Agrikit conventions
├── lsp.json                     # Language server configuration
├── plugin.json                  # Plugin manifest
└── README.md
```

## Agents

| Agent | For | What it does | Skills |
| --- | --- | --- | --- |
| `agrikit-design` | Product designers | Scaffolds, reviews, and iterates on components and tokens from natural language | component-scaffold, design-token-sync, lsp-assist |
| `agrikit-engineering` | Software engineers | Implements library components, writes hooks, sets up LSP, enforces harnessing rules | all four |
| `agrikit-collab` | Both | Handoff checklists, design ↔ code consistency reports, shared vocabulary | design-token-sync, component-scaffold, lsp-assist |

Select one with `/agent` in an interactive session.

## Skills

| Skill | Purpose |
| --- | --- |
| `component-scaffold` | Create `src/components/<Name>/` with types, component, CSS module, stories, tests, MDX docs, and barrel |
| `design-token-sync` | `pull` tokens from Figma/exports, `validate` token files and component usage, `propose` new tokens (DTCG JSON ↔ CSS variables) |
| `hook-generator` | Create `src/hooks/use<Name>.ts` + tests following Agrikit hook rules |
| `lsp-assist` | Explain diagnostics, completion hints for props/variants/tokens, reference-aware refactors, LSP setup |

Each `SKILL.md` documents its `inputs`, `outputs`, numbered `steps`, and `examples`.

## Hooks

Copilot CLI hooks fire on native lifecycle events, so `hooks/hooks.json` uses the
native `{ "version": 1, "hooks": { … } }` format. The Agrikit events are
implemented by `hooks/scripts/agrikit-hooks.mjs`, which receives the Agrikit
event name as its argument and filters the native payload:

| Agrikit event | Native trigger | Behaviour |
| --- | --- | --- |
| `on_file_open` | `postToolUse`, `view` | When a file in `src/components/<Name>/` is opened, adds its `.mdx`/README excerpt, related stories/types paths, and a pointer to `agrikit_get_component` to the agent's context |
| `on_component_create` | `postToolUse`, `create` | When `<Name>.tsx` or a component CSS file is created, asks the agent to run `design-token-sync` in validate mode and lists raw colour/px values it found |
| `on_pr_open` | `postToolUse`, `bash`/`powershell` (`gh pr create`) or `*create_pull_request` tools | Asks the agent to run an `agrikit-collab` design-engineering consistency check on the new PR |
| `on_skill_complete` | `postToolUse` `skill` (start) + `agentStop` (complete) | Appends `skill_invoked` and `skill_completed` JSON lines to `.agrikit/audit/skills.jsonl` in the project |

Hooks never block the agent: on any error they exit `0` with no output. Add
`.agrikit/audit/.pending-*` to your `.gitignore`; commit `skills.jsonl` if you want
the audit trail shared with your team.

## MCP servers

| Server | Transport | Tools |
| --- | --- | --- |
| `agrikit` | stdio (`node ${PLUGIN_ROOT}/mcp/server/index.mjs`) | `agrikit_get_conventions`, `agrikit_list_components`, `agrikit_get_component`, `agrikit_get_tokens` |
| `figma` | HTTP (`https://mcp.figma.com/mcp`) | Figma's remote MCP server, used by `design-token-sync` to read variables |

The Agrikit server reads the project in its working directory. Override paths
with `AGRIKIT_PROJECT_ROOT`, `AGRIKIT_COMPONENTS_DIR`, `AGRIKIT_TOKENS_PATH`, and
`AGRIKIT_TOKENS_CSS_PATH` (see [docs/conventions.md](docs/conventions.md)), or pass
`projectRoot` to a tool call.

## LSP servers

| Server | Command | Files |
| --- | --- | --- |
| `agrikit-typescript` | `typescript-language-server --stdio` | `.ts .tsx .js .jsx .mts .cts .mjs .cjs` |
| `agrikit-css` | `vscode-css-language-server --stdio` | `.css .scss .less` |

## Conventions

[docs/conventions.md](docs/conventions.md) defines the component layout, naming,
design tokens (`--agk-*`), hook rules, accessibility baseline, and the agentic
harnessing rules every agent and skill follows. Agents read it through the
`agrikit_get_conventions` tool.

## Example session

```text
> /agent            (choose agrikit-design)
> Scaffold a Tag primitive with neutral, success, and warning variants.
  → component-scaffold creates src/components/Tag/…
  → on_component_create hook → design-token-sync validate → "0 violations"
> /agent            (choose agrikit-engineering)
> Generate a useDisclosure hook and use it in Tag's dismiss button.
> Open a PR for this.
  → on_pr_open hook → agrikit-collab consistency report
```

## Development

- Edit files, then run `copilot plugin update agrikit` (or reinstall from the local path) and `/restart`.
- Smoke-test the MCP server: `printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node mcp/server/index.mjs`.
- Smoke-test a hook: `echo '{"cwd":".","toolArgs":{"path":"src/components/Button/Button.tsx"}}' | node hooks/scripts/agrikit-hooks.mjs on_file_open`.
