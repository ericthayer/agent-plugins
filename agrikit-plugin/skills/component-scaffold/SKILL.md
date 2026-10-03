---
name: component-scaffold
description: Scaffold a new Agrikit React component with the correct folder structure, naming conventions, typed variants, token-only styles, stories, tests, and docs. Use when asked to create, scaffold, or bootstrap an Agrikit component or add a component variant.
metadata:
  version: "1.0.0"
  plugin: agrikit
---

# component-scaffold

**Version:** 1.0.0

Creates a new component folder that follows the Agrikit conventions
(call `agrikit_get_conventions` on the Agrikit MCP server for the full rules).

## Inputs

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` (PascalCase, `^[A-Z][A-Za-z0-9]*$`) | Yes | Component name, e.g. `Tag`. Used for folder, files, and exports. |
| `type` | `"primitive" \| "composite" \| "layout" \| "pattern"` | Yes | Component category; sets the Storybook title and guidance in docs. |
| `variants` | `string[]` (kebab-case) | No (default `["default"]`) | Values of the `variant` prop union, e.g. `["neutral", "success"]`. |
| `sizes` | `("sm" \| "md" \| "lg")[]` | No | Values of the `size` prop union. Omit for components without sizes. |
| `element` | `string` (HTML tag) | No (default `div`, `button` for interactive primitives) | Root DOM element the ref is forwarded to. |
| `tokens` | `string[]` | No | Semantic token names the design calls for (e.g. `color.action.primary`). Each is verified with `agrikit_get_tokens`. |
| `componentsDir` | `string` | No (default `src/components` or `$AGRIKIT_COMPONENTS_DIR`) | Components root. |

## Outputs

A folder `<componentsDir>/<name>/` containing:

| File | Content |
| --- | --- |
| `<name>.types.ts` | `export type <name>Variant`, `<name>Size`, `export interface <name>Props extends React.ComponentPropsWithoutRef<'<element>'>` |
| `<name>.tsx` | `forwardRef` function component, named export, `displayName`, `data-variant`/`data-size` attributes |
| `<name>.module.css` | `.root` styles and `[data-variant]` selectors using only `var(--agk-…)` tokens |
| `<name>.stories.tsx` | `title: 'Agrikit/<Type>/<name>'`, one story per variant plus `Playground` |
| `<name>.test.tsx` | Render, variant attribute, ref forwarding, and accessible-name tests |
| `<name>.mdx` | Overview, anatomy, variants table, usage do/don't, accessibility notes |
| `index.ts` | `export { <name> } from './<name>'; export type * from './<name>.types';` |

Plus a short summary message listing the files created, the tokens used, and any
tokens that were requested but do not exist.

## Steps

1. Validate `name` against `^[A-Z][A-Za-z0-9]*$` and `type` against the allowed values; stop with a clear error if invalid.
2. Call `agrikit_list_components`. If a component named `name` already exists, stop and offer to add a variant instead. If a similar component exists (same type and overlapping purpose), mention it and ask whether to continue.
3. Call `agrikit_get_conventions` and read one existing component of the same `type` with `agrikit_get_component` to mirror local patterns (test library, story format, CSS approach). If the project has no components yet, use the templates below.
4. Call `agrikit_get_tokens` and resolve every entry in `tokens` to a CSS variable. Record missing tokens; **do not** substitute raw values — leave a `/* TODO(agrikit): missing token <name> */` comment and report it.
5. Create the files listed in **Outputs** in the order: types → component → styles → index → stories → tests → docs.
6. Ensure the component forwards its ref, spreads remaining props, merges `className`, and sets `data-variant` / `data-size`.
7. Run the project's existing type-check, lint, and test commands for the new files (discover them from `package.json`). Fix issues introduced by the scaffold.
8. Output the summary. The plugin's `on_component_create` hook will prompt a `design-token-sync` validation of the new component; run it when prompted.

## Templates

`<name>.tsx` (for `name = Tag`, `element = span`):

```tsx
import { forwardRef } from 'react';
import styles from './Tag.module.css';
import type { TagProps } from './Tag.types';

export const Tag = forwardRef<HTMLSpanElement, TagProps>(function Tag(
  { variant = 'neutral', size = 'md', className, children, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      data-variant={variant}
      data-size={size}
      className={[styles.root, className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </span>
  );
});

Tag.displayName = 'Tag';
```

`<name>.module.css`:

```css
.root {
  display: inline-flex;
  align-items: center;
  gap: var(--agk-space-2);
  padding-inline: var(--agk-space-2);
  border-radius: var(--agk-radius-full);
  font: var(--agk-font-label-sm);
}

.root[data-variant='neutral'] {
  background: var(--agk-color-surface-muted);
  color: var(--agk-color-text-default);
}
```

## Examples

**Invocation**

> Use the component-scaffold skill: name `Tag`, type `primitive`, variants `neutral, success, warning`, sizes `sm, md`, element `span`, tokens `color.surface.muted, color.feedback.success, color.feedback.warning`.

**Result**

```
Created src/components/Tag/
  Tag.types.ts      TagVariant = 'neutral' | 'success' | 'warning'; TagSize = 'sm' | 'md'
  Tag.tsx           forwardRef<HTMLSpanElement, TagProps>
  Tag.module.css    uses --agk-color-surface-muted, --agk-color-feedback-success, --agk-color-feedback-warning
  Tag.stories.tsx   Agrikit/Primitive/Tag – Neutral, Success, Warning, Playground
  Tag.test.tsx      4 tests
  Tag.mdx           overview, variants, usage, accessibility
  index.ts
Missing tokens: none
Checks: tsc ✅  eslint ✅  vitest ✅ (4 passed)
```
