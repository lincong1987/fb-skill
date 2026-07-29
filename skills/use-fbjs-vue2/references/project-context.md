# Project Context and Evidence Policy

## Establish the target runtime

Read the target project's `package.json`, lockfile, application entrypoints, and installed package manifests before making API decisions. Dependency ranges are intent; the installed `node_modules` version is the runtime baseline.

Confirm all of the following:

- Vue resolves to a 2.x release and matches `vue-template-compiler`.
- `fb-core`, `fb-ui`, or another FBJS package is actually installed.
- Element UI/Plus is not being mistaken for FbUI merely because APIs look similar.
- The relevant application or screen entrypoint installs the component owner's plugin.

## Application bootstrap

FBJS applications commonly create an `Application` from `fb-core` and pass plugins through its `use` option. Frequently encountered source entries include:

```js
import FbUI from 'fb-ui/src/index'
import FbThird from 'fb-third/src/index'
import TpComponents from '@topinfo/tp-components'
```

Treat these as audited Vue 2 patterns, not universal imports. Preserve the target entrypoint's verified plugin options because they may configure default props, themes, maps, players, or business integrations.

Do not add a second `Vue.use(...)`, CSS bundle, or alternative package entry without checking the exact installed source and existing bootstrap.

## Evidence aliases

Generated references use stable aliases instead of machine paths:

- `project:` - the target repository
- `installed:<package>/...` - the target repository's exact runtime under `node_modules`
- `upstream:<owner>/...` - an explicitly supplied read-only source repository

Upstream repositories are optional. Supply them through `--fbjs-root`, `--admin-root`, `--screen-root`, `--ai-root`, or `--player-root`. Never change branches, format, generate into, clean, reset, or repair an upstream repository while using it as evidence.

## Selecting evidence

- Prefer exact installed source over a newer upstream checkout.
- Use upstream code to investigate drift or missing context, never to silently introduce an API absent from the installed package.
- Use target-project examples for wiring and naming, then verify their component APIs against installed source.
- Treat backups, demos, tests, generated bundles, README files, `.d.ts`, `llm.md`, and legacy agent rules as secondary evidence.
- Never copy secrets, tokens, credentials, internal URLs, or environment configuration into generated references.

## Project-specific legacy

The bundled guard baseline is empty. If a target project contains reviewed legacy violations, place exact fingerprint allowances in `.agents/fbjs-vue2/known-legacy.json`. Keep each allowance scoped to a path, rule, fingerprint, count, and reason. Never reuse another project's baseline.
