---
name: hook-generator
description: Generate a custom React hook that follows Agrikit conventions (naming, object return shape, SSR safety, effect cleanup, JSDoc, and tests). Use when asked to create or extract a React hook in an Agrikit project.
metadata:
  version: "1.0.0"
  plugin: agrikit
---

# hook-generator

**Version:** 1.0.0

## Inputs

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` (`^use[A-Z][A-Za-z0-9]*$`) | Yes | Hook name, e.g. `useDisclosure`. |
| `purpose` | `string` | Yes | One-sentence description of what the hook does. |
| `params` | `{ name: string; type: string; default?: string }[]` | No | Hook parameters (usually a single options object). |
| `dependencies` | `string[]` | No | React APIs and project modules the hook may use, e.g. `["useState", "useEffect", "@/lib/storage"]`. New npm packages are **not** added automatically. |
| `returns` | `{ name: string; type: string; description: string }[]` | Yes | The return shape. Rendered as an exported `<Name>Result` interface. |
| `hooksDir` | `string` | No (default `src/hooks` or `$AGRIKIT_HOOKS_DIR`) | Hooks root. |

## Outputs

- `<hooksDir>/<name>.ts` — the hook with exported `<Name>Options` (when it has params) and `<Name>Result` types, and a JSDoc block with `@example`.
- `<hooksDir>/<name>.test.ts` — tests using the project's existing test runner and `@testing-library/react` `renderHook` (or the project's equivalent).
- An optional export line added to `<hooksDir>/index.ts` if that barrel exists.
- A summary of files, return shape, and check results.

## Steps

1. Validate `name`. Search the hooks directory (and `lsp-assist` workspace symbols) for an existing hook with the same name or purpose; if found, stop and propose extending it.
2. Call `agrikit_get_conventions` and read one existing hook to mirror style (imports, test utilities).
3. Confirm every entry in `dependencies` is a React API or already present in `package.json`/the repo. Stop and ask if a new package would be required.
4. Write the hook:
   - Return an **object** matching `returns` (a tuple only for a single `[value, setValue]` pair).
   - Wrap returned functions in `useCallback`; memoise derived objects with `useMemo` when returned.
   - Access `window`/`document`/`localStorage` only inside effects or guarded by `typeof window !== 'undefined'`.
   - Every subscription, listener, interval, or timeout is cleaned up in the effect's return.
5. Write tests covering initial state, each returned function, cleanup on unmount, and SSR-safety where relevant.
6. Update the barrel file if one exists.
7. Run the project's existing type-check, lint, and tests for the new files and fix issues.
8. Output the summary with a usage example.

## Template

```ts
import { useCallback, useState } from 'react';

export interface UseDisclosureOptions {
  /** Initial open state. @default false */
  defaultOpen?: boolean;
}

export interface UseDisclosureResult {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

/**
 * Manages open/closed state for disclosures such as dialogs, menus, and accordions.
 *
 * @example
 * const { isOpen, toggle } = useDisclosure();
 * <Button aria-expanded={isOpen} onClick={toggle}>Filters</Button>
 */
export function useDisclosure({ defaultOpen = false }: UseDisclosureOptions = {}): UseDisclosureResult {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);
  return { isOpen, open, close, toggle };
}
```

## Examples

**Invocation**

> Use hook-generator: name `useMediaQuery`, purpose "track whether a CSS media query matches", params `[{ name: "query", type: "string" }]`, dependencies `["useState", "useEffect"]`, returns `[{ name: "matches", type: "boolean", description: "Whether the query currently matches" }]`.

**Result**

```
Created src/hooks/useMediaQuery.ts
  export function useMediaQuery(query: string): UseMediaQueryResult  // { matches: boolean }
  SSR-safe: initial matches=false, subscribes to matchMedia in useEffect, removes listener on cleanup
Created src/hooks/useMediaQuery.test.ts (3 tests)
Updated src/hooks/index.ts
Checks: tsc ✅  eslint ✅  vitest ✅ (3 passed)

Usage:
  const { matches: isCompact } = useMediaQuery('(max-width: 40rem)');
```
