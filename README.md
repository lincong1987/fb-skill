# FB Skill

`fb-skill` is a Codex plugin containing `use-fbjs-vue2`, a source-grounded workflow for Vue 2 applications built with FBJS and FbUI.

It helps agents inspect the installed runtime, distinguish FbUI from Element UI, identify component ownership, and validate common Vue 2 FBJS usage errors.

## Contents

```text
.codex-plugin/plugin.json
skills/use-fbjs-vue2/
```

The skill follows the open agent skills format and can be used as a bundled plugin skill or installed from this repository for local Codex discovery.

## Use

Invoke the skill explicitly with:

```text
$use-fbjs-vue2
```

From the target Vue 2 project, let `<skill-root>` be the installed `skills/use-fbjs-vue2` directory:

```powershell
node "<skill-root>/scripts/inspect-component.cjs" fb-button --project-root .
node "<skill-root>/scripts/check-fbjs-usage.cjs" --root .
node "<skill-root>/scripts/refresh-catalog.cjs" --project-root .
```

The catalog command writes target-specific output to `.agents/fbjs-vue2/`; it does not modify the installed skill.

## Requirements

- A Vue 2 target project with its dependencies installed.
- An installed FBJS/FbUI runtime to inspect. The target project's `node_modules` is the API source of truth.
- Node.js capable of running the target project's installed tooling.

Optional read-only upstream source roots can be supplied with `--fbjs-root`, `--admin-root`, `--screen-root`, `--ai-root`, and `--player-root`. They are drift evidence only and never replace installed runtime APIs.

## Project-specific Baselines

The bundled guard has no historical allowances. To allow reviewed legacy findings for one project, add `.agents/fbjs-vue2/known-legacy.json` in that project. Keep allowances exact and do not copy them between repositories.

## Publishing

This repository is an installable Codex plugin package. Use the plugin installation or marketplace flow provided by your Codex surface, or install the contained skill for local discovery during evaluation. See the [Codex skills and plugins documentation](https://developers.openai.com/plugins/build/plugins) for packaging and distribution details.
