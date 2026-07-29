---
name: use-fbjs-vue2
description: Source-grounded Vue 2 FBJS and FbUI development guidance. Use when creating, changing, reviewing, debugging, or explaining Vue templates, fb-* or tp-* components, FBJS bootstrapping, component ownership, forms, tables, dialogs, dates, uploads, messages, charts, maps, players, screen-base, admin-base, tp-components, or fb-ai integrations; also use whenever Element UI and FbUI APIs might be confused.
---

# Use FBJS Vue2

Work from runtime evidence. FBJS/FbUI APIs may resemble Element UI, but their props, events, slots, methods, services, imports, and CSS conventions are not interchangeable.

Let `<skill-root>` mean the directory containing this `SKILL.md`. Do not assume the skill is installed inside the target repository.

## Required workflow

1. Confirm that the target repository uses Vue 2 and installs FBJS/FbUI packages. Stop and report a mismatch instead of applying these rules to Vue 3 or Element UI projects.
2. Read [project-context.md](references/project-context.md) before changing application integration, imports, aliases, or shared conventions.
3. Inspect every unfamiliar component from the target project root:

   ```powershell
   node "<skill-root>/scripts/inspect-component.cjs" fb-button --project-root .
   ```

4. Read the relevant reference before writing code:
   - FbUI runtime and services: [fb-ui-runtime.md](references/fb-ui-runtime.md)
   - Element UI differences and forbidden substitutions: [fb-ui-vs-elementui.md](references/fb-ui-vs-elementui.md)
   - Forms, tables, dialogs, dates, and uploads: [usage-patterns.md](references/usage-patterns.md)
   - fb-core, fb-third, assets, themes, and ownership: [fbjs-ecosystem.md](references/fbjs-ecosystem.md)
   - admin-base, screen-base, and tp-components: [admin-and-screen.md](references/admin-and-screen.md)
   - fb-ai and fb-player: [fb-ai-and-player.md](references/fb-ai-and-player.md)
5. Inspect the installed source file reported by the lookup tool when an API is absent, unresolved, inherited through a mixin, or version-sensitive. Do not guess.
6. Follow nearby valid project pages for integration conventions, but verify their APIs against installed source because project examples may contain legacy mistakes.
7. Run the guard before finishing:

   ```powershell
   node "<skill-root>/scripts/check-fbjs-usage.cjs" --root .
   ```

## Source-of-truth order

For component API shape, use this order:

1. The exact installed package under the target project's `node_modules`.
2. A corresponding upstream Vue 2 source explicitly supplied with a `--*-root` option, only for investigation and drift comparison.
3. A current project example cross-checked against installed source.
4. Source-adjacent README/demo, `.d.ts`, or legacy agent rules as hints only.

For project integration conventions, inspect the target's application entrypoints, configuration, and a valid nearby page before package examples.

## Non-negotiable rules

- Keep Vue at version 2 semantics. Never read or import `packages-vue3`, `fb-ui-v3`, Element UI, or Element Plus as substitutes.
- Do not translate `el-*` APIs mechanically. Inspect the actual emitted events.
- Use globally registered FBJS tags only when the target bootstrap installs their owning plugin.
- Do not invent named imports such as `import { FbButton } from 'fb-ui'`.
- Treat `fb-*` as a naming convention, not proof of ownership. Inspect charts, players, maps, AI components, screen components, and local components individually.
- If lookup is ambiguous or unresolved, report the uncertainty and cite the source path instead of completing the API from memory.

## Generate a target-specific catalog

Generate references into the target repository's `.agents/fbjs-vue2` directory:

```powershell
node "<skill-root>/scripts/refresh-catalog.cjs" --project-root .
node "<skill-root>/scripts/refresh-catalog.cjs" --project-root . --check
```

Pass `--fbjs-root`, `--admin-root`, `--screen-root`, `--ai-root`, or `--player-root` only when those read-only upstream repositories are available. Installed runtime source remains authoritative.

To allow reviewed project-specific legacy findings, create `.agents/fbjs-vue2/known-legacy.json` in the target repository using the same exact fingerprint schema as `scripts/known-legacy.json`. Never copy another project's allowances.
