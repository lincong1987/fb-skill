---
name: manage-fb-skill
description: FB Skill 安装与管理：安装或更新这套 Skill，或清除项目里旧 fb-rules 的 FB 管理文件；先逐文件预览，绑定真实批准后执行，保留其他工具配置和用户自定义内容。
---

# Manage FB Skill

一次性管理能力，不参与日常页面开发。`<skill-root>` 为本目录；与 create-fb-feature、use-fbjs-vue2 整套分发。

## 1. 预览

用户明确要求安装、更新或清旧规则时，识别 **具体目标项目** 和包来源。默认项目 `.agents/skills`；目标宿主要求时可用 `.claude/skills`。不自动全局安装或扫所有项目。

```sh
node "<skill-root>/scripts/install.cjs" scan --project-root "<目标项目>" --action install-and-clean
```

行动选 `install`、`clean-legacy` 或 `install-and-clean`；scan 只读。来源仓库、目录链接、未知修改和混放内容单列，不能整目录清空 `.cursor`、`.qoder`、`.fb` 等。

**完成条件**：文件级新增/更新/清理清单、冲突/保留项和包来源明确；尚未写目标文件。

## 2. 提案与真实批准

```sh
node "<skill-root>/scripts/install.cjs" plan --project-root "<目标项目>" --action install-and-clean --id "<安全任务名>"
```

给人展示提案哈希及具体变化，再按 [批准与归档](../create-fb-feature/references/output-conventions.md) 直接复用已确认显示名；无有效档案才首次登记一次。复用显示名不批准本次清单，仍需录入本次真实用户批准。未知身份、静默、agent/tool 通知、测试 fixture 都不能批准。

**完成条件**：本次具体清单绑定最新方案与真实批准。用户只说“清理旧 FB 规则”但尚未看具体清单时，不能据此清除混放的自定义文件。

## 3. 执行与复验

```sh
node "<skill-root>/scripts/install.cjs" apply --project-root "<目标项目>" --id "<安全任务名>"
```

执行前重验源/目标哈希、路径类型和批准版本；变化就停止，重新提案。安装更新只改本套已管理且未被用户修改的文件；旧规则只清理已知精确指纹，未知/修改内容保留。

不调用旧 `fb rule rm/clear`，不清 `node_modules`、锁文件、npm 缓存、Git/SVN 元数据或其他工具配置。依赖卸载、ignore/SVN 属性与远端发布只报告建议，不冒充已做。

**完成条件**：实际变更、保留/冲突、失败/部分执行、可恢复位置均如实输出；重新 scan 确认。目录为空不是“所有旧配置已下线”的证明。

## 边界

本地批准与哈希检查是防误操作/审计工具，不是不可绕过的系统安全沙箱。不能证明姓名对应企业账号或权限；直接绕开工具修改文件仍需宿主与组织控制。

清理能力不需要旧 fb-rules 继续安装；发布包只包含旧文件指纹，不把旧规则全集重新注入模型。
