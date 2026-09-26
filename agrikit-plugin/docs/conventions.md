# Agrikit Conventions

This is the single source of truth for Agrikit conventions. The Agrikit agents,
skills, hooks, and the `agrikit_get_conventions` MCP tool all reference this file.
Projects can override defaults with the environment variables listed at the end.

## 1. Component library layout

Every component lives in its own PascalCase folder under the components root
(default `src/components/`):

```
src/components/<ComponentName>/
├── <ComponentName>.tsx          # Implementation (named export + forwardRef)
├── <ComponentName>.types.ts     # Public props / variant types
├── <ComponentName>.module.css   # Styles – tokens only, no raw values
├── <ComponentName>.stories.tsx  # Storybook stories, one per variant
├── <ComponentName>.test.tsx     # Behaviour + accessibility tests
├── <ComponentName>.mdx          # Usage docs (do / don't, anatomy, a11y notes)
└── index.ts                     # Barrel: export component + types
```

- **Names**: PascalCase (`DataTable`), matching folder and file names. Props
  interface is `<ComponentName>Props`.
- **Types** (`type` in skills): `primitive` (Button, Icon), `composite`
  (Card, Dialog), `layout` (Stack, Grid), `pattern` (FilterBar, EmptyState).
- **Variants**: expressed through a single `variant` prop typed as a string-literal
  union (e.g. `'primary' | 'secondary' | 'ghost'`). Sizes use `size: 'sm' | 'md' | 'lg'`.
  Default values are documented in the `.mdx` file and stories.
- Components are function components, forward refs to the root DOM element, spread
  remaining native props onto the root, and accept a `className` for composition.
- CSS class names use the `agk-` prefix via CSS Modules: `.root`, `.root[data-variant='primary']`.
- Stories title: `Agrikit/<Type>/<ComponentName>`.

## 2. Design tokens

- Source of truth: `tokens/tokens.json` in [W3C Design Tokens (DTCG)](https://tr.designtokens.org/format/)
  format (`$value`, `$type`, optional `$description`).
- Generated output: `src/styles/tokens.css` exposing CSS custom properties on `:root`.
- Naming: `--agk-<category>-<name>[-<modifier>]`, kebab-case, derived from the
  JSON path (e.g. `color.action.primary` → `--agk-color-action-primary`).
- Categories: `color`, `space`, `size`, `radius`, `font`, `line-height`,
  `shadow`, `motion`, `z`.
- Semantic tokens (`color.action.primary`) reference core tokens
  (`{color.green.600}`); components must only consume **semantic** tokens.
- Component CSS must not contain raw hex/rgb/hsl colours or raw `px` spacing
  values; `0`, `1px` hairline borders, and `100%` are allowed.

## 3. React hooks

- Location: `src/hooks/use<Name>.ts` with `src/hooks/use<Name>.test.ts`.
- Name starts with `use` + PascalCase (`useDisclosure`, `useTokenValue`).
- Return an **object** with named fields; tuples only for a single
  `[value, setValue]` state pair.
- SSR-safe: never touch `window`/`document` during render; guard in effects.
- Every effect that subscribes, listens, or times out must clean up.
- Stable callbacks (`useCallback`) for returned functions; document dependencies
  with a JSDoc block including an `@example`.
- No data fetching libraries inside hooks unless the project already uses them.

## 4. Accessibility

- WCAG 2.2 AA is the baseline. Interactive components are keyboard operable,
  have visible focus (`--agk-color-focus-ring`), and expose correct roles/names.
- Colour contrast is validated against token pairs during token sync.

## 5. Agentic harnessing rules

These rules apply to every Agrikit agent and skill:

1. **Ground before generating.** Read this file (or call `agrikit_get_conventions`)
   and look up existing components/tokens (`agrikit_list_components`,
   `agrikit_get_tokens`) before creating anything new.
2. **Never invent tokens.** If a needed token does not exist, stop and propose it
   as a token change instead of hard-coding a value.
3. **Small, reviewable diffs.** Change one component, hook, or token group per step.
4. **Verify.** Run the project's existing type-check, lint, and test commands after
   changes and use LSP diagnostics to confirm there are no new errors.
5. **Flag, don't guess.** When a design spec is ambiguous or conflicts with the
   implementation, surface the conflict to the user instead of silently choosing.
6. **Leave an audit trail.** Skill runs are logged to `.agrikit/audit/` by the
   plugin hooks; do not delete or rewrite these logs.
7. **No secrets.** Never write access tokens (e.g. Figma tokens) into files.

## Project overrides

| Variable | Default | Purpose |
| --- | --- | --- |
| `AGRIKIT_PROJECT_ROOT` | current working directory | Project root used by the MCP server |
| `AGRIKIT_COMPONENTS_DIR` | `src/components` | Components root |
| `AGRIKIT_HOOKS_DIR` | `src/hooks` | React hooks root |
| `AGRIKIT_TOKENS_PATH` | `tokens/tokens.json` | DTCG token source |
| `AGRIKIT_TOKENS_CSS_PATH` | `src/styles/tokens.css` | Generated CSS variables |
| `AGRIKIT_AUDIT_DIR` | `.agrikit/audit` | Skill audit trail directory |
