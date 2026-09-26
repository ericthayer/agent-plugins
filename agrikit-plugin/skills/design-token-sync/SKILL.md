---
name: design-token-sync
description: Sync, validate, and propose Agrikit design tokens between Figma or other design sources and the component library (DTCG JSON and CSS variables). Use when tokens change in Figma, when a component must be checked for raw values, or when a missing token must be proposed.
metadata:
  version: "1.0.0"
  plugin: agrikit
---

# design-token-sync

**Version:** 1.0.0

Keeps `tokens/tokens.json` (DTCG source of truth), the generated
`src/styles/tokens.css`, and component styles consistent with the design source.

## Inputs

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `mode` | `"pull" \| "validate" \| "propose"` | Yes | `pull`: import/update tokens from a design source. `validate`: check token files and component usage. `propose`: draft new tokens for a missing need. |
| `source` | `"figma" \| "file"` | For `pull` | Where design tokens come from. `figma` uses the Figma MCP server (variables of the linked file); `file` reads an exported JSON (Tokens Studio / Figma Variables export / DTCG). |
| `sourceRef` | `string` | For `pull` | Figma file/frame URL, or path to the exported JSON file. |
| `scope` | `string` (path or glob) | No (default: components root) | Component folder(s) to validate, e.g. `src/components/Tag`. |
| `categories` | `string[]` | No (default: all) | Limit to token categories, e.g. `["color", "space"]`. |
| `dryRun` | `boolean` | No (default `true` for `pull`) | Report the diff without writing files. |

## Expected token formats

**Source – `tokens/tokens.json` (DTCG):**

```json
{
  "color": {
    "green": { "600": { "$type": "color", "$value": "#2F7D32" } },
    "action": {
      "primary": { "$type": "color", "$value": "{color.green.600}", "$description": "Primary actions" }
    }
  },
  "space": { "2": { "$type": "dimension", "$value": "0.5rem" } }
}
```

**Generated – `src/styles/tokens.css`:**

```css
:root {
  --agk-color-green-600: #2F7D32;
  --agk-color-action-primary: var(--agk-color-green-600);
  --agk-space-2: 0.5rem;
}
```

Mapping rule: JSON path joined with `-`, prefixed with `--agk-`; aliases
(`{a.b.c}`) become `var(--agk-a-b-c)`.

## Outputs

A Markdown report with these sections, plus file changes when not a dry run:

- **Summary**: counts of added / changed / removed / unchanged tokens, and violations.
- **Token diff** (`pull`): table `token | old value | new value | change type`.
- **Violations** (`validate`): table `file:line | issue | suggested token`. Issue types: `raw-value`, `unknown-token`, `core-token-in-component`, `unresolved-alias`, `contrast-fail`.
- **Proposals** (`propose`): DTCG JSON snippet for each new token with name, value, type, and rationale.
- **Impacted components**: components that consume changed tokens.

## Steps

1. Call `agrikit_get_conventions` and `agrikit_get_tokens` (format `json`) to load current tokens; stop with guidance if `tokens/tokens.json` is missing.
2. **pull**
   1. `figma`: use the Figma MCP server tools to read the variables/styles of `sourceRef`. If the Figma MCP server is not authenticated, ask the user to authenticate it (never ask them to paste a token into a file). `file`: read and parse the JSON at `sourceRef`.
   2. Normalise to DTCG: kebab/lowercase path segments, `$type` from the source type, colours as hex, dimensions in `rem` (px ÷ 16) unless the category is `size` borders.
   3. Diff against the current tokens; classify added / changed / removed. Removed tokens are **never** deleted automatically — mark them deprecated with `$extensions.agrikit.deprecated: true`.
   4. If `dryRun` is false, write `tokens/tokens.json`, then regenerate `tokens.css` using the project's existing token build script if one exists (e.g. `npm run tokens`), otherwise update the CSS variables with the mapping rule above.
3. **validate**
   1. Check every alias resolves and there are no cycles.
   2. Scan styles and components in `scope` for raw colours (`#hex`, `rgb(`, `hsl(`), raw `px`/`rem` spacing (allowing `0`, `1px`, `100%`), unknown `--agk-*` variables, and core tokens used directly in components.
   3. For each violation suggest the closest semantic token (same category, nearest value).
   4. Check text/background semantic pairs meet WCAG 2.2 AA (4.5:1 text, 3:1 large text and UI).
4. **propose**: draft the new semantic token(s) aliasing existing core tokens where possible; include a rationale and ask for design approval before writing.
5. List impacted components by searching for the changed CSS variables (use `lsp-assist` / grep for references).
6. Output the report. Do not modify component files in `validate` mode unless the user asks for fixes.

## Examples

**Invocation (validate after scaffold)**

> Run design-token-sync in validate mode on `src/components/Tag`.

**Result**

```
Summary: 0 token changes, 1 violation
Violations
| file:line                          | issue      | suggested token                 |
| src/components/Tag/Tag.module.css:14 | raw-value `#E8F5E9` | --agk-color-feedback-success-subtle |
Impacted components: Tag
```

**Invocation (pull from Figma, dry run)**

> Sync tokens from https://www.figma.com/design/AbC123/Agrikit-Foundations (colour only).

**Result**

```
Summary: 2 changed, 1 added, 0 removed
| token                 | old     | new     | change  |
| color.green.600       | #2F7D32 | #2E7A31 | changed |
| color.green.700       | #276A2A | #25672A | changed |
| color.feedback.info   | —       | {color.blue.600} | added |
Impacted components: Button, Tag, Alert
Dry run – no files written. Reply "apply" to write tokens.json and regenerate tokens.css.
```
