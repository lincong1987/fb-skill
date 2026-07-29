# FbUI Versus Element UI

Use this as a rejection checklist, not as an API translation table. When a component is not listed, inspect it rather than extending the analogy.

| Concern | Audited FBJS/FbUI Vue 2 pattern | Do not write without source evidence |
| --- | --- | --- |
| Package | `fb-ui/src/index`, installed through `Application.use` | `element-ui`, `element-plus` |
| Tags | `fb-*`, `tp-*`, package/local screen tags | `el-*` |
| Theme prefix | `jpx-*` | new `.el-*` selectors |
| Button event | `FbButton`: `@on-click` | `<fb-button @click>` |
| Button size | `s`, `m`, `l` | `mini`, `small`, `medium` |
| Form rules | `rule` | `rules` |
| Dialog visibility | ref methods `show()`, `hide()`, `close()` | `visible.sync` |
| Select options | commonly `:data="[{ value, label }]"` | nested `el-option` |
| Message warning | `$message.warn(...)` | `$message.warning(...)` |
| Confirmation | callback-based `$confirm(...)` | `$confirm(...).then(...)` or `await $confirm(...)` |
| Notification | `$notification(...)` with `placement` | `$notify(...)` |
| Table | `fb-simple-table` configuration and service | `el-table-column`/Element pagination |
| Date formatting | `tp-datepicker value-format` | raw `fb-datepicker value-format` |
| Upload | `tp-upload`/`tp-upload-path` | new raw `fb-upload` |

## Event exception policy

Do not ban every `@click`: native HTML and local components can legitimately use it, and `FbLink` supports its own `click` prop/event behavior. The guard only rejects the known-wrong `<fb-button @click>` form. Check literal runtime `$emit` calls for every other FB component.

## Import policy

FbUI's source entry globally registers its registry. It does not provide trustworthy Element-style named component imports. Reject:

```js
import { FbButton, FbForm } from 'fb-ui'
```

Do not replace a verified source entry with `fb-ui/lib` or add a separate bundled CSS import without checking the exact installed build and target bootstrap.

## Vue version boundary

Everything under any `packages-vue3` tree, any `fb-ui-v3` package/path, `element-plus`, `createApp`, and Vue 3-only `v-model` conventions is outside this skill's Vue 2 scope. The refresh tool must reject rather than catalog those sources.
