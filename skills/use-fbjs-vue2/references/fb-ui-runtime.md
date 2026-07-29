# FbUI Runtime Reference

## Installation and ownership

In audited Vue 2 releases, `installed:fb-ui/src/index.js` is the runtime installation entry. Inspect the installed file to confirm whether it applies global defaults, registers `packages/components/components.js`, installs prototype services, and loads the pc3 Less theme.

- Component CSS classes use the `jpx` prefix from `src/config.js`.
- Do not infer component count or ownership from documentation; generate the target-specific catalog.
- The audited package entry does not expose reliable named component exports. Use verified global tags. If local import is truly needed, inspect and use an exact installed deep source path.
- `fb-ui`'s default export spreads an array and therefore does not provide `FbUI.FbButton`-style keys.

## Events

Events are defined by literal `$emit` calls and are component-specific. Common FBJS events include `on-click`, `on-change`, `on-close`, `on-clear`, and `on-select`, while some components also emit Vue2 `input` or native-like `change`/`click` events.

Never establish a global rewrite such as “all `@click` must become `@on-click`.” Instead, inspect the component:

```powershell
node "<skill-root>/scripts/inspect-component.cjs" fb-link --project-root .
```

In the audited Vue 2 line, `FbButton` emits `on-click`, uses `s`/`m`/`l` sizes, and separates native `elType` from styling `type`. Recheck the installed component before relying on these details.

## Programmatic services

Audited FbUI entries install these names on `Vue.prototype`; verify the target entry:

| API | Important behavior |
| --- | --- |
| `$loadingBar` | Global progress/loading bar service |
| `$loading` | FbUI loading service; inspect its source before passing options |
| `$message` | Use levels implemented by source, including `warn`; do not use Element's `warning` alias |
| `$msgbox` | Base message-box service |
| `$alert` | Alert callback service |
| `$confirm` | Callback API: message, confirm callback, cancel callback, options |
| `$notification` | Notification service; not Element's `$notify` |

`$confirm` is not a Promise API. A service request inside the confirm callback may return a Promise; that is different from calling `.then()` on `$confirm` itself.

Message options use `align`. Notification options use `placement`. Verify the installed implementation before using less-common options.

## Forms and dialogs

- `FbForm` and `FbFormItem` both declare the singular `rule` prop.
- `FbForm.validate(callback)` supports a callback and also contains a Promise fallback. Follow local Page conventions rather than Element Form examples.
- Do not assume Element-only methods such as `clearValidate`; use only methods shown by `inspect-component` or source.
- `FbDialog` internally controls `isShow`; show it via a ref and `show()`, then use `hide()`/`close()` as implemented. Do not use Element's `visible.sync` contract.

## Source caveats

- `types/components.d.ts` and `llm.md` lag runtime and contain wrong named-import and service examples.
- Old `.qoder/rules` claims that types are the only truth; this contradicts the running code.
- Source-adjacent `test/**/*.vue` files are demo pages, not assertion-based tests.
