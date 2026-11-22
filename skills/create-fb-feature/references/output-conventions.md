# 批准、审计与实现归档

**何时读**：准备写业务代码、安装/清理或记录实现结果。审批在实施前落盘，失败/跳过也留痕，不在收尾补造同意。

## 显示名：一次设置，以后复用

```sh
node "<skill-root>/scripts/resolve-identity.cjs" --project-root "<实际工程根>"
```

- 已确认项目档案优先，再已确认全局档案。返回非空 `operator` 就直接复用显示名和原身份确认记录；新任务、新方案也不重复询问姓名、确认姓名或运行 `--save`。
- 只有没有有效档案时才自动获取 Git 署名、SVN 最后作者、系统用户名等候选，首次由真实用户确认候选或补充名字一次。候选不等于当前人；SVN 作者只是历史元数据。邮箱可选，不猜姓名/邮箱。
- 记录实际首次身份确认原文和来源引用。默认存于实际工程根的 `.agents/fb-feature/profile.json`，供该工程后续任务复用；经用户授权保存到 `~/.fb-skill/profile.json` 后可跨工程复用。不为复用已有全局档案再次要求授权。
- 旧无确认、invalidated、fixture 或损坏档案不自动升级。像是“没记住”时先核对 `--project-root` 是否用了另一副本或子目录；不要直接覆盖。用户明确要求更新时先读原哈希，失效档案还需显式重新确认。

以下保存命令只用于首次登记，不是每个任务或每次批准前的步骤：

```sh
node "<skill-root>/scripts/resolve-identity.cjs" --project-root "<工程>" --save \
  --name "<用户确认的显示名>" --confirmation-text "<真实确认原文>" --source-ref "<真实来源引用>"
```

这些占位符不是可复制的真实人或批准证据；自动生成 example 同意不能使门禁通过。**复用显示名只省去重复身份登记，不省去对当前方案的真实批准。**

## 固化方案

在工程内以工具创建不可变方案。输入至少有安全 id、kind、summary、files、acceptance；文件清单含本次变更和归档位置。

```json
{
  "id": "device-list-change",
  "kind": "feature",
  "summary": "按本轮已讨论方案修改设备列表",
  "files": ["src/views/device/list.vue", "docs/features/device-list-change.md", "CHANGELOG.md"],
  "acceptance": ["字段与已确认接口一致", "查询和错误分支通过目标测试"]
}
```

```sh
node "<skill-root>/scripts/workflow.cjs" plan --project-root "<工程>" --input "<方案JSON>"
```

方案绑定项目 realpath、修订号和 SHA-256；修订产生新版本，不覆盖旧版本。展示当前方案和文件/接口/验证清单，真实人明确批准后才录入。

## 批准与检查

```sh
node "<skill-root>/scripts/workflow.cjs" approve --project-root "<工程>" --id "<id>" \
  --plan-hash "<当前方案完整hash>" --evidence-text "<真实用户批准原文>" --source-ref "<真实用户消息引用>"
node "<skill-root>/scripts/workflow.cjs" check --project-root "<工程>" --id "<id>"
```

approve 是证据录入，不是 AI 代人决定；非交互模式必须来源真实输入，终端模式只接受真实 TTY。计划修改/哈希不符/身份未确认/合成数据/缺来源/审计破坏都应拒绝。不得把“继续调查”或审批另一方案的同意拿来授权新方案。

宿主确实提供计划批准结果时，可采用 `host-plan` 渠道，保留该次结果、完整已展示计划原文/hash、实际工程根、来源引用和脚本录入时间；不把界面结果冒充聊天原话。已展示并获批的日志标签可首次保存，不声称实名认证。

```sh
node "<skill-root>/scripts/resolve-identity.cjs" --project-root "<工程>" --save \
  --name "<已批准的显示标签>" --host-approval "<根内真实宿主结果.json>"
node "<skill-root>/scripts/workflow.cjs" approve --project-root "<工程>" --id "<id>" \
  --plan-hash "<当前派生方案hash>" --evidence-kind host-plan --host-approval "<根内真实宿主结果.json>"
```

派生方案 metadata.hostApproval 必须绑定同一份结果，只在其真实批准范围内实施；新需求/扩大范围仍须新批准。普通工具成功、代理通知和手写 approved:true 不是宿主批准。该JSON的hash只能防误改，无法证明离开宿主记录后的来源真实性；宿主未提供确认时不得自行制作它。

本地脚本无法向宿主验证某段聊天文本是否真来自那位人，也不能验证企业角色权限；不把本地哈希链称为数字签名、企业 IAM 或不可绕过安全沙箱。组织需要强保证时接宿主身份与审批服务，不自称已完成。

## 实时审计

存储：`.agents/fb-feature/workflows/<id>/plans/plan-vN.json` 与 `events.jsonl`。追加 seq、prevHash/hash、时间/时区、actor、事件与细节；锁内验证原链与当前计划。

```sh
node "<skill-root>/scripts/workflow.cjs" event --project-root "<工程>" --id "<id>" \
  --type implementation-start --details '{"scope":"当前批准范围"}'
node "<skill-root>/scripts/workflow.cjs" event --project-root "<工程>" --id "<id>" \
  --type verification --details '{"check":"目标命令","status":"fail","exitCode":1,"evidence":"本地输出文件"}'
node "<skill-root>/scripts/workflow.cjs" verify --project-root "<工程>" --id "<id>"
```

CLI 的非批准事件不能代替批准。`--details @evidence/result.json` 只读取当前 `--project-root` 内的相对文件，拒绝绝对路径、越界和链接。时间由脚本真实采集，不任填一条漂亮时间线。失败、部分执行、未做验证都记录；不等全部通过才建立档案。

## 实现档案与 CHANGELOG

准备 JSON 包含 title、summary、files、interfaces、todos、verification；验证项写 name、status（pass/fail/skipped/not-run）、command/exitCode、evidence 或原因。

```sh
node "<skill-root>/scripts/archive.cjs" --project-root "<工程>" --id "<id>" --input "<结果JSON>"
node "<skill-root>/scripts/archive.cjs" --project-root "<工程>" --id "<id>" --input "<结果JSON>" --apply
```

第一条只预览，第二条在批准范围和当前哈希校验后追加：

- `docs/features/<id>.md`：需求、当前方案与批准、文件、API、待办、验证、事件引用。
- 既有 `CHANGELOG.md`/`docs/CHANGELOG.md`：按功能聚合实际改动，不把每个文件拆成变更。已有内容保留。
- 同一功能沿用 id 追加修订；重复相同输入不重复写条目，新功能用新 id。档案不能替代原始审计链。

`workflow report` 可生成审计的只读 Markdown，输出新文件时拒绝覆盖。提交消息作为建议，只有用户要求才 git commit/push。

## 真实与测试分开

演练 fixture 位于发布 Skill 之外、隔离 HOME/临时项目。模拟身份与批准不写真实档案、不授予真实目标开发权限。静态测试、浏览器、联调、Java 编译、SQL 执行各自记录证据，未做不写通过。
