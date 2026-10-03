---
name: lsp-assist
description: LSP-powered code intelligence for Agrikit projects - explains diagnostics, gives completion hints for components, props, variants, and tokens, and plans reference-aware refactors using the TypeScript and CSS language servers bundled in the Agrikit plugin configuration.
metadata:
  version: "1.0.0"
  plugin: agrikit
---

# lsp-assist

**Version:** 1.0.0

Uses the language servers configured by the Agrikit plugin (`lsp.json`):
`typescript-language-server` for `.ts/.tsx/.js/.jsx` and
`vscode-css-language-server` for `.css/.scss/.less`.

## Inputs

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `task` | `"diagnose" \| "complete" \| "refactor" \| "setup"` | Yes | `diagnose`: explain and fix diagnostics. `complete`: suggest valid props/variants/tokens at a location. `refactor`: plan and apply a reference-aware change. `setup`: check/install language servers. |
| `file` | `string` | For `diagnose`, `complete` | File to analyse. |
| `position` | `{ line: number; character: number }` | No | Cursor position for `complete` or a specific diagnostic. |
| `symbol` | `string` | For `refactor` | Symbol to change, e.g. `ButtonProps.kind`, `--agk-color-action-primary`. |
| `change` | `string` | For `refactor` | Desired change, e.g. "rename to `variant`". |
| `audience` | `"designer" \| "engineer"` | No (default `engineer`) | Adjusts explanation depth and jargon. |

## Outputs

- **diagnose**: table `file:line | code | message | plain-language explanation | fix`, followed by the applied (or proposed) fix.
- **complete**: ranked list of valid completions with type/default and a one-line description (for tokens: CSS variable, resolved value, and intended use).
- **refactor**: list of all references grouped by file, the edit plan, the applied edits, and post-change diagnostics count (must be ≤ the count before).
- **setup**: which servers are available, and exact install commands for missing ones.

## Steps

1. Ensure language servers are available (`setup` is implicit): if the LSP tools report that a server is missing, give install commands — `npm i -g typescript typescript-language-server` and `npm i -g vscode-langservers-extracted` — and stop unless the user wants to proceed without LSP.
2. **diagnose**: collect diagnostics for `file`; for each, identify the root cause (often a `variant`/`size` value not in the union, a missing token, or a prop type mismatch), explain it for the `audience`, and propose the smallest type-safe fix (no `any`, no `@ts-ignore`). Apply the fix if the user asked for it, then re-check diagnostics.
3. **complete**: use hover/completion at `position`; for Agrikit components enrich results with `agrikit_get_component` (variant unions, defaults); inside CSS `var(--agk-` enrich with `agrikit_get_tokens` and prefer semantic tokens.
4. **refactor**: find all references/definitions of `symbol` via LSP (and grep for CSS variables and string usages in stories/docs); present the plan; apply edits with the LSP rename where possible; update `.stories.tsx` and `.mdx`; re-run diagnostics and the project's type-check.
5. Summarise results in the output format above.

## Examples

**Invocation**

> lsp-assist diagnose `src/components/Button/Button.stories.tsx` for a designer.

**Result**

```
| file:line                     | code   | message                                             |
| Button.stories.tsx:18         | TS2322 | Type '"outline"' is not assignable to type 'ButtonVariant'. |
Explanation: The Button only supports the variants primary, secondary, and ghost. "outline" isn't one of them — the closest match in Agrikit is `secondary`.
Fix: change `variant: 'outline'` to `variant: 'secondary'` (or ask engineering to add an `outline` variant).
```

**Invocation**

> lsp-assist refactor symbol `ButtonProps.kind`, change "rename to `variant`".

**Result**

```
References: 14 in 6 files (Button.tsx, Button.types.ts, Button.stories.tsx, Button.test.tsx, Dialog.tsx, Toolbar.tsx)
Applied LSP rename + updated Button.mdx examples
Diagnostics: before 0, after 0 · tsc ✅
Migration note: `kind` → `variant` (breaking) added to CHANGELOG draft
```
