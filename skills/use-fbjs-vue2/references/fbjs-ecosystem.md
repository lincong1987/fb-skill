# FBJS Ecosystem and Ownership

## Ownership is evidence, not a prefix

Use the component catalog or lookup command before importing a component. Important owners include:

| Capability | Owner/runtime entry |
| --- | --- |
| Core forms, layout, feedback, table, picker, basic display | `fb-ui/src/index` |
| `FbEcharts`, `FbEditor`, `FbTmap`, `FbQrcode`, `FbLottie`, `FbLmap*` | `fb-third/src/index` |
| Video players (`FbPlayer`, `FbHikh5Player`, etc.) | `@topinfo/fb-player` |
| `FbThreeMap` | `@topinfo/fb-three` |
| `TpDatepicker`, `TpDialog*`, `TpUpload*` | `@topinfo/tp-components` |
| `ScreenPanel*`, `ScreenFlop*`, `ScreenSearch`, video-wall helpers | `@topinfo/screen-base` |
| Project-specific `Fb*` or `Screen*` names | local components; inspect their import/registration |
| `FbAi*` | `fb-ai` when installed and registered; upstream-only records are unavailable |

## fb-core

`fb-core` provides the application lifecycle rather than UI widgets.

- `Application` installs plugins, gathers router/service/store contexts, creates router/store/root application state, and injects utilities such as `$svc`, `$service`, `$storage`, `$datax`, `$cookie`, `$dayjs`, `$axios`, `$ebus`, `$uuid`, and `$`.
- Root exports vary by version. Allow `fb-core/src/...` deep imports only when verified in the installed package; do not invent root exports.
- Inspect the installed `Page` export before assuming that named page helpers are included.
- Avoid SSR assumptions: the UI stack expects browser globals.

## fb-third

Audited `fb-third/src/index.js` releases install direct components plus an LMap registry, initialize ECharts themes, and expose `$echarts`. Verify the installed entry and generated catalog.

- TDT installs only when `opts.tdt.tk` is supplied.
- Swiper installs when requested or in production according to the runtime entry.
- Named chart-model and motion exports are not globally registered. For example, `FbecLineBase` must be imported with `import { FbecLineBase } from 'fb-third'` and registered in the page's `components`; verify each named export with the lookup command because its API may come from a mixin.
- Ignore stale claims about BMap/AMap/SuperMap or Swiper 4.5.1 when runtime dependencies/imports disagree.
- Treat `src/index-esm.js` and broken nested installer code as lower confidence than the entry's actual import graph.

## Assets and theme

`fb-assets` exports resource descriptors (`pdf`, `leaflet`, `loading`, `tianditu`, `hik`, `easyplayer`) consumed by FB CLI/project page asset configuration. It is not a Vue component library.

Prefer the theme imported by the installed FbUI entry. Do not introduce an independent theme package or bundle based on stale documentation.

## Other installed Topinfo packages

`@topinfo/form-designer` and `@topinfo/schedule-ui` primarily contribute routes/services/views through the project/application generator. Do not assume that every installed `@topinfo` package globally registers UI components. Inspect its main entry and current screen/bootstrap use.

Packages such as `fb-admin`, `fb-mock`, incomplete GUI plugins, Electron image tools, or polyfill builders are not substitutes for FbUI components.
