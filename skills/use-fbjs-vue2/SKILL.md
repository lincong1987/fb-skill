---
name: use-fbjs-vue2
description: FB Vue 2 源码取证与校验：检查 fb/tp/screen 组件的实际拥有者、props/events/slots/methods，或排查 FbUI 与 Element UI API 混用、安装版本和本地覆盖；供功能开发流程按需调用。
---

# Use FBJS Vue2

**取证**：先确认实际安装、当前入口和本地覆盖，再使用 API。相似名字不是相同契约。

`<skill-root>` 是本文件目录，不假设安装在目标仓库内。

## 检查流程

1. 确认目标 Vue 2.6/2.7 与模板编译器匹配，实际安装 FB 包。Vue 3 或其他 UI 目标先报告不匹配，不借 Vue 2 API。
2. 需要装配/别名/共享约定时读 [工程取证](references/project-context.md)，日常单组件不全读生态资料。
3. 查陌生组件：
   ```sh
   node "<skill-root>/scripts/inspect-component.cjs" fb-button --project-root "<工程>"
   ```
4. 歧义时核对有效注册/页面 import，再收窄：
   ```sh
   node "<skill-root>/scripts/inspect-component.cjs" tp-dialog --project-root "<工程>" --owner project-local
   node "<skill-root>/scripts/inspect-component.cjs" tp-dialog --project-root "<工程>" --file "<已确认源码>"
   ```
   不按使用次数挑选候选；owner 内仍多实现时用精确 file。子入口自动升到最近 package 根会报告覆盖范围，可用 --stop-root 限边界。
5. 按本次涉及读取：
   - [FbUI API](references/fb-ui-runtime.md)：事件、表单、消息/对话框。
   - [Element 差异](references/fb-ui-vs-elementui.md)：容易混用的契约。
   - [使用片段](references/usage-patterns.md)：窄片段，不是完整页面模板。
   - [生态拥有者](references/fbjs-ecosystem.md)：core/third/地图/资源。
   - [Admin/Screen/TP](references/admin-and-screen.md)：插件/包装与注册。
   - [AI/播放器](references/fb-ai-and-player.md)：仅涉及这些能力时读。
6. unresolved、mixins、动态 props/events 或版本差异读工具指出的实际源文件；未证实就标未知。
7. 改过 Vue 2 FB 应用后跑窄守卫：
   ```sh
   node "<skill-root>/scripts/check-fbjs-usage.cjs" --root "<工程>"
   ```
   保存退出码并分类命中；缺 parser、解析失败或链接范围未扫描会报告检查不完整。不要把 wrapper/合法版本差异当已确认业务缺陷，不因 0 命中宣布全部合规。

**完成条件**：本次 API 对应当前 owner/source/version，未解析项清楚，校验结果与未做运行范围如实记录。

## 证据优先级

有效入口/局部注册决定采用谁；再查该实现的目标安装源码。hoisted 包按 Node 解析查实际路径，package 声明范围不当运行版本。

指定 `--fbjs-root/--admin-root/--screen-root/--ai-root/--player-root` 只供上游调查/漂移；Vue 2.7 fork、Vue 2.6 主线和 Vue 3 不混。项目调用点、types、README/demo、旧 rules 是线索，不补造 API。

本地 `name: 'tp-dialog'`、Pascal/camel 命名都会参与候选；静态候选不证明已全局注册，实际 import/插件顺序需人查。工具不完整分析动态注册或 mixin 内所有语义。

## 可选 catalog

需要持久目录时：

```sh
node "<skill-root>/scripts/refresh-catalog.cjs" --project-root "<工程>"
node "<skill-root>/scripts/refresh-catalog.cjs" --project-root "<工程>" --check
```

写入 `.agents/fbjs-vue2`，不改安装的 Skill；写目标项目需要该操作授权，不因“检查”就无告知覆盖。

工具的 parser 来自目标安装依赖；测试可显式传 `--deps-root`/`FBJS_DEPS_ROOT` 借 parser，不改变目标 FB 包版本。缺 parser 明示未执行，不联网补装或拿其他项目 API 充数。

真实项目 reviewed legacy allowances 仅 exact fingerprint，放 `.agents/fbjs-vue2/known-legacy.json`；逐条理由/范围，不复制另一个项目的宽泛豁免。

开发批准和实现档案由 create-fb-feature 的流程负责；本 Skill 的只读取证不冒充人同意。
