# 公告管理反推试点 · 使用说明

状态：**候选输入 v1，等待真实确认，不开始生成**。本目录是源码仓库的研发评估材料，不是日常加载的 Skill 规则。

## 四份输入的用途

| 文件 | 谁可读取 | 用途 |
|---|---|---|
| requirements.md | 用户/生成方/验收方 | 开发人员能描述的需求 R01-R12，含七个待确认选择 |
| contracts.json | 用户/生成方/验收方 | 公开接口、编码、版本、合成数据与本地 mock 约定 |
| acceptance.json | 用户/验收方，不给生成方 | 检查项及公开输入依据；不是自动评分结果 |
| evidence.json | 用户/研究与验收方，不给生成方 | 旧实现和安装源码指纹/行段/未知；不是规范答案 |

验收项必须由公开输入支持；填写了引用 ID 不代表语义一定正确，需人工复核。旧源码不合理行为单独记账，不为追求“1:1”复制日期覆盖、范围变形等缺陷。

## 当前候选选择

D01-D07 见 requirements.md 的 R12。所有 status=proposed、confirmation=null；没有人确认当前规则，没有生成结果。不能把总体安排批准改记成这一版输入批准。

## 准备与复核

从 fb-skill 源码仓库运行（不依赖外部包，不自动安装）：

```sh
node scripts/eval-reverse-requirements.cjs prepare --project-root "<fb-skill根>" --case evals/reverse-requirements/smsnotice --id smsnotice-pilot-v1 --scope evals/reverse-requirements/smsnotice/generation-scope.json
node scripts/eval-reverse-requirements.cjs check --project-root "<fb-skill根>" --id smsnotice-pilot-v1
node scripts/eval-reverse-requirements.cjs check-generation --project-root "<fb-skill根>" --id smsnotice-pilot-v1 --round first --stage start
```

prepare 仅创建 `.agents/fb-feature/workflows/<id>/plans/plan-vN.json` 与计划事件，四份输入的字节 SHA-256 绑定到计划。check 不写输出；当前应为 ready=false，退出 3，并列出 NOT_APPROVED、DECISIONS_PENDING。

用户确认当前需求后，采用已有身份档案中的 `operator`，通过 workflow 保存这次批准的来源；有有效显示名档案就直接复用，不重复询问或保存姓名。只有无有效档案时才首次登记身份一次，不能写一个 confirmed 标签替代真实确认。每项 confirmation 要保存 decisionId、当前 `{id,requirementIds,proposal}` 的稳定哈希、带时区 confirmedAt、已确认 operator 与 kind/reference/text；当前工具要求确认人与本方案批准人一致，且确认时间不晚于批准事件。哈希或格式无法鉴别宿主外伪造的消息，不能用测试对象补造真人确认。确认会改变契约内容时，必须重建当前计划修订再批准；输入任何变化都使旧绑定失效。请勿复制测试中的合成批准到真实目录。

## 生成前仍须做的事情

- 工具不会生成页面或调用 AI。带 scope 的 prepare 只登记两轮精确路径、输入/范围哈希和4个测试工具指纹，不创建生成输出。
- `generation-scope.json` 列出六份未来源码，以及公开输入、源码清单、构建日志/产物、访问核对和验收证据；prepare 展开到 first/repaired 两轮并放入计划 files。尚不存在源码的内容哈希不能提前造，freeze 以后再记录。
- start-generation 只有当前输入/具体范围获批时才复制公开输入到空工作区，不写任何业务源码；freeze-generation 必须实际六份源码齐全、无额外文件、无链接、公开副本等于批准输入，再不可变封存。失败保留现场并尽力记 blocked，不能覆盖重跑。
- 新上下文生成只拿公开输入与 Skill；准确公共安装源码允许读，旧业务模块和隐藏验收不允许读。保留真实访问记录，不能宣称工具具备硬隔离。
- 核对 GMRHCP 的准确 runtime 和工具链。四份文件的内容哈希没有自动复核外部 node_modules 或旧源码当前字节，实施前要显式核对并留证；构建工具会核对实际依赖版本并禁原项目配置/缓存写入。
- 真正运行之后保存生成源码、清单、命令/exit/warnings、截图/请求等原始证据，首轮结果冻结后再在 repaired 新目录整改。两轮同输入同方案，旧源码与报告变化会拒绝整改。

## 批准后的执行入口（当前不要执行真实案例）

```sh
node scripts/eval-reverse-requirements.cjs start-generation --project-root "<fb-skill根>" --id "<已批准当前id>" --round first
# 独立生成任务此后写批准的 workspace/src 文件；本工具不生成
node scripts/eval-reverse-requirements.cjs freeze-generation --project-root "<fb-skill根>" --id "<已批准当前id>" --round first
node tests/fixtures/reverse-requirements/build.cjs --project-root "<fb-skill根>" --id "<已批准当前id>" --round first
node tests/fixtures/reverse-requirements/serve.cjs --project-root "<fb-skill根>" --id "<已批准当前id>" --round first
```

构建用准确目标已装 webpack4/vue-loader15/Vue2.6，不借 SOL07。仅 `dist/index.html` 和 `dist/app.js`，样式/资源内联，原配置/Babel配置/磁盘缓存不执行。编译开始时在审计中占用本轮，防并发；编译结束复核输入/工具/源码，失败会保存真实错误报告而不是通过。失败或半写也不能覆盖同轮；另行调查并经新范围授权，不能删掉证据凑绿。

静态服务只绑定 scope 的 `127.0.0.1:18733`，无 API 代理；精确校验构建报告、日志和两份资产后才启动。端口占用停止，不扫描替代端口。serve.log 为追加运行日志，不是不可变首轮成绩；每次追加检查链接。当前18731页面不属于本案例。

## 记录结果（不是执行测试）

已经按当前计划真实获批且完成实际检查后，可提供结果 JSON：

```json
{
  "checks": [
    { "id": "A01", "status": "not-run", "detail": "尚未执行浏览器检查" }
  ]
}
```

再运行：

```sh
node scripts/eval-reverse-requirements.cjs record --project-root "<fb-skill根>" --id "<已批准当前id>" --round first --result "<根内相对结果输入.json>"
```

- 只接受验收 ID 及 pass/fail/partial/not-run；pass 需实际 evidence，不能伴随非零退出码；其他状态需理由。
- 缺失检查记 not-run，不偷偷补成 pass。命令退出 0 表示记录成功，result 的 status 仍可能是 fail/partial；生成模式下任何pass需当前已冻结源码的成功构建证据，编译claim未完成时拒封存，避免永久绑定未完成结果。
- 输出 JSON/Markdown 只写一次；整改用 repaired，绑定同一计划/输入及完整首轮结果哈希。换需求或换案例必须新评估 ID，不能改题后算整改通过。
- 多文件写入不是原子事务；读回确认本次输出完整后才追加结果事件。若写入中途失败保留现场，尽力记 blocked，非零退出且返回 retainedPaths；审计也写失败会明确报告。不能重试覆盖或把半写首轮当整改基准。
- ready 只表示可记录提供的结果，不授权生成；sourceVerification 明确 not-run，因为工具没有自动核验外部源码/版本。当前案例的外部指纹另有真实准备检查证据。
- recordedBy 为记录器，authorizedBy 为当前批准人，不冒充人亲自执行检查；partial 结果如实保留，不改名为跳过。

所有 mock 文件名称/字典文案/单位/日期均为合成；业务日期可控，审计时间取真实时钟。真实后端、数据库、上传/下载/预览、文件权限、复杂富文本、旧页像素一致性与跨项目准确率不在当前通过声明中。
