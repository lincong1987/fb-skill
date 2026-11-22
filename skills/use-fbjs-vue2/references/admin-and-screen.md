# Admin, Screen, and TP Components

## admin-base

Audited Vue 2 releases of `@topinfo/admin-base` install a generator that contributes service/router/store contexts and may export screen utilities. It is not automatically a general global `Fb*` component registry.

For application work:

- Prefer installed source and the target project's pages.
- If an upstream admin repository is supplied, inspect the matching ref with `--admin-ref` without switching its external worktree.
- Allow deep imports only when verified in the installed package.

## tp-components

Audited registries commonly contain:

- `TpDatepicker`
- `TpDialog`
- `TpDialogTab`
- `TpDialogFlowTab`
- `TpDialogStepTab`
- `TpUpload`
- `TpUploadPath`

Its plugin can also install a report SDK and exports its own `Page` helper. Use the exact Page imported by the relevant entry/page; do not assume it is the same object as `fb-core` Page.

Common contracts that must be rechecked against the installed version:

- `TpDatepicker` supplies `valueFormat`/`value-format` conversion around raw `FbDatepicker`.
- `TpDialog.show(url, param, title, options)` expects the Promise returned by `import()` for new code.
- `TpUpload`/`TpUploadPath` implement business attachment conventions, including `attachId` records.

## screen-base

Audited `@topinfo/screen-base` plugins register a `componentList`, apply configured default props, and add `$env(name)`. Verify those behaviors in the installed entry.

Its registry includes screen panels, titles, search/toolbars, rank/flop helpers, screen table charts, and player/video-wall wrappers. Use `inspect-component` for exact names and APIs.

Do not assume every `<screen-*>` tag belongs to screen-base. Target repositories may define local global or locally imported screen components. The catalog reports ownership from registration/import evidence and may mark ambiguous names.

## Project-local components

Local PascalCase, camelCase or kebab-case names (`TpDialog`, `tpDialog`, `tp-dialog`) do not turn a component into a library component. Keep its verified local import/registration pattern. The static catalog lists candidates, not proof that every candidate is installed globally. When duplicate names exist, verify the active entry/import and narrow with `--owner`/`--file`; do not select by tag or usage count alone.
