# FB AI and Player Packages

## fb-player

Audited `@topinfo/fb-player` releases register a component list from `src/components/index.js`, which may include:

- `FbPlayer`
- `FbHikh5Player`, `FbHikPlayer`
- `FbEasyPlayer`, `FbEasyPlayerPro`
- `FbHyPlayer`
- `FbDhh5Player`, `FbDhgovPlayer`, `FbJsbcPlayer`, `FbKdPlayer`, `FbUniseePlayer`, `FbHlsPlayer`

Inspect the target bootstrap to confirm that the plugin is installed and which concrete player is selected. Facade and vendor players do not share every option.

Do not attribute these components to `fb-ui` merely because their names start with `Fb`.

## fb-ai status

Do not assume `fb-ai` is installed or has a consumable package entry. Resolve its target-project manifest and installed entry before importing it.

An upstream `src/components/index.js` may expose a component registry and named exports, but upstream discovery does not make those components available in the target application. Treat every `FbAi*` entry as unavailable until the dependency, Vue 2 compatibility, consumer entry, and bootstrap registration are verified.

Do not:

- Copy README installation examples without resolving the package entry.
- Copy Element-derived names or APIs from stale AI docs (`El*`, Element UI install instructions, or drifted props/events).
- Copy tokens, authorization headers, credentials, internal endpoints, or example secrets from `api` references, `src/main.js`, demos, or service files.
- Silently add `fb-ai` as part of a UI task. That is a dependency/product decision.

When an AI upstream root is supplied without an installed package, the catalog may include `FbAi*` components for ownership discovery with `not-installed` availability. Keep unresolved or parse issues visible.

## Safe adoption checklist

If a task explicitly adopts fb-ai:

1. Select and install a version with a valid consumer entry.
2. Verify Vue 2 compatibility and build parsing.
3. Inspect the exact installed registry and component SFCs.
4. Define authentication/configuration outside source and documentation.
5. Add the package to the relevant `Application.use` entry only after verifying its install export.
6. Refresh this catalog and remove `not-installed` only when the runtime resolves successfully.
