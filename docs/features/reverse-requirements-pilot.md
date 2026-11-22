# 公告管理反推试点：当前实现档案

日期：早期候选阶段为2026-11-21；最新执行为2026-11-22。本文保留早期候选记录，**当前已另建confirmed输入并独立生成、本地编译和GUI检查；最新状态见文末“本轮发布收口”**。

## 需求与授权

用户提出从旧列表/新增/查询/修改页面反推开发人员可以描述的需求，用同一份需求重做后检查保真度，并要求“可以，你来安排后续计划”。总体计划 v1 已获宿主计划批准；批准范围包含证据、候选输入与最小准备/复核/结果留痕工具。

总体批准不授权尚未展示的具体需求版本。当前 D01-D07 均为 proposed，confirmation 为 null；没有真实显示名确认，没有当前输入的真实批准事件。Git/OS 名字、代理报告、临时回归里的“同意”都不是本次用户批准。

不改参考业务工程和 node_modules，不改现有 18731 演练，不连真实后端/数据库/文件服务，不提交、推送或发布。

## 候选材料 v1

目录：`evals/reverse-requirements/smsnotice/`。

- `requirements.md`：R01-R12，自然语言字段、操作、状态、布局、失败行为与待确认选择。
- `contracts.json`：公开接口/参数、准确安装版本、合成时钟/字典/数据、文件回显与提交、失败/状态不一致开关。候选 mock 契约不冒充完整后端认证。
- `acceptance.json`：27 条检查与 6 类明确未执行项，验收方使用；每条检查引用公开需求/契约，来源用于说明事实，不作为暗加考点。记录 pass/fail/partial/not-run，不计算无依据的总体准确率。
- `evidence.json`：11 份准确根下源码的 SHA-256/字节数/行段、已知版本、未知项和旧实现问题；不提供给生成任务。
- `README.md`：隔离输入面、复核和后续执行说明。

源证据来自准确 GMRHCP `branches/V3.51-20261116/mew-manage-ui`，不是 SOL07 或同名副本。附件的按关联 ID 查询也是本地 mock 范围；真实上传/下载/预览不在范围内。

## 工具公开边界

`scripts/eval-reverse-requirements.cjs` 的 prepare/check/record：

- prepare 读取四份输入并绑定内容哈希，创建候选工作流；不批准、不创建生成工作区。
- check 只读复核当前计划/批准、输入漂移及未确认选择；不准备依赖、不生成、不访问后端。
- record 只记录调用方实际提供的检查证据，不执行浏览器或自动评分。失败不转通过；首轮/整改轮分开，不覆盖既有输出，整改绑定同计划/输入与完整首轮哈希。部分写失败保留现场并尽力记 blocked，不冒充成功；记录器与批准人分开。
- decision confirmation 绑定当前编号/提案哈希、真实确认来源、带时区时间与本方案批准人；这只防误绑定，仍不能鉴别宿主外的伪造消息。

当前历史 v1 计划只覆盖结果 JSON/Markdown，**不是生成源码的写入授权**。本轮准备工具新增 scope、空工作区公开输入复制、实际源码封存和构建/服务入口；准确两轮路径需通过 `generation-scope.json` 登记成新修订。仍须在当前需求确认后重新绑定输入，经真人批准当前具体范围；有效显示名档案直接复用，不逐任务重新确认。不存在的源码哈希不预填。

本地哈希/追加事件用于防误操作与追溯，不是 IAM、签名或硬隔离；工具不捕获所有 Read，引用 ID 校验也不能替代人工判断验收是否真的写在公开输入里。

## 必须保留的首轮边界

1. 生成任务使用新上下文，只提供冻结的需求、公开契约、Skill 和明确允许的公共安装源码。不复用看过旧业务模块的研究代理。
2. 不提供旧业务源码、隐藏验收或本研究档案；真实访问核对以后才能说明隔离程度。
3. 使用 GMRHCP Vue/compiler 2.6.12、fb-ui 1.1.840、fb-core 1.1.824、TP 2.2.16 与其已有构建链；缺依赖记 not-run，不安装或换 SOL07 runtime。
4. 首轮生成物/日志/读范围/结果冻结后才能整改，整改结果另存。
5. 浏览器通过也只是 mock 页面结果。真实文件、鉴权、后端状态/幂等、数据库、旧页像素对照等未执行项独立列出。

## 当前候选登记（未批准）

已实际调用 prepare 登记 `smsnotice-pilot-v1` 的 v1 候选计划：

- 输入内容哈希：`7dc170d07db228e382dc6e33a7fb1ae67e7e1d6db9481581de845523970bc97f`。
- 候选计划哈希：`7b1d7e8b851e77ec149190aa53184ae63bb16139394b74907a83c5fa63f97830`。
- 文件：`.agents/fb-feature/workflows/smsnotice-pilot-v1/plans/plan-v1.json`。
- check 实际退出 3、ready=false：NOT_APPROVED 与 D01-D07 DECISIONS_PENDING。没有创建生成输出、没有写 approval、actor 未确认保持 null。
- 指纹及门禁复核证据：`.validation-output/reverse-preparation-source-check-20261121.json`，使用脚本真实采集检查时间；不是页面验收或用户批准。

这是当前待审输入的登记，不是授予生成权限；内容修改须新修订绑定。实际生成范围仍待后续明确与批准。

## 生成环境准备（2026-11-22）

宿主批准的本轮范围只是准备工具、独立测试环境及范围说明，不批准 D01-D07 或当前公告页面生成。所有真实业务资料仍只读，未创建公告 workspace/src。

新增：
- `generation-scope.json`：六份候选源码和精确证据路径，first/repaired 统一预先声明。
- 评估工具 `checkGeneration/startGeneration/freezeGeneration`：围栏、空目录、公开输入副本、实际字节清单及漂移复核；不调用 AI、不生成源码。
- `tests/fixtures/reverse-requirements/{build.cjs,webpack.config.cjs,serve.cjs,index.html}`：targetRequire 显式目标依赖，webpack4资源内联/单bundle，禁止原业务启动配置/落盘缓存，固定loopback端口。
- `tests/reverse-runtime.test.cjs`：临时极简 Vue SFC 的真实构建/静态协议回归，不是公告模块功能或浏览器质量验收。

准备通过也不省略当前需求和具体方案确认；身份是一次登记后复用，不是每次门禁都重新填名字。首轮冻结后不能改源码、报告或工具；改变输入或范围须新评估，不算同题整改。

候选v2已经登记（批准数0，56个精确计划路径）：
- planHash：`56c1c772a0c27d8020435e0f120f2643ed2c22e7cfa97c8922dd3164698eaf32`。
- scopeHash：`7440dea1a2fcae5dac7d5125c3c0c9c6044888c1c04ac93fdb25fae9ad10c085`。
- inputHash：仍为上文候选需求v1的`7dc170d07db228e382dc6e33a7fb1ae67e7e1d6db9481581de845523970bc97f`，D01-D07未确认。
- v1计划保留，v2是追加修订，不原地改计划；check-generation start仍ready=false/NOT_APPROVED/DECISIONS_PENDING，没有生成目录或页面。

当前准备回归：初次Node24/18完整工具各185pass/0fail/0skip；未提供额外旧依赖根173pass/12skip/0fail。新GMRHCP构建样本仍实际执行，跳过是旧catalog/guard/screen检查，不把本机存在的GMRHCP工程说成零外部环境。结构与dry-run57文件检查通过，实际tgz未重建。

随后静态收口补了执行副本与批准工具bytes比对、编译进行中禁止封存结果、未构建或失败构建不得登记pass，以及runtime版本map必填；这些有独立红绿回归。候选v2不覆盖，另追加v3绑定当前工具内容：
- planHash：`9acf1933267debf91155c1ad074ae3a1f1ab9f8dcc4434cf264303df5a4cade0`。
- scopeHash：`e6d7e9eea9325c54a486f925350344d91f84078661d49bc551fba656a14f863c`。
- inputHash未变化、56路径、批准数0，仍未启动公告生成。
- 最终回归Node24/18各189pass/0fail/0skip；未提供额外旧依赖根177pass/0fail/12skip。证据以验证报告所列final日志为准，不回填初次185项成绩。
- v3门禁/工具bytes/审计真实复核：`.validation-output/generation-preparation-final-evidence-20261122.json`；这是准备结果，不是人批准或页面验证。

## 验证与待办

本次新增测试只验证准备/复核/留痕工具，临时批准与显示名只在 os.tmpdir 合成 fixture 内存在，不写真实用户 profile。

实际命令、计数、跳过及分发检查以 [本地验证报告](../validation.md) 为准，不把本档案当测试证据。

待办：当前输入真实确认 → 当前实施文件清单批准 → 干净上下文生成 → 同数据对照 → 冻结首轮 → 一轮整改复验。当前停在第一项之前。显示名先读有效档案直接复用；没有有效档案才首次登记一次，不与每轮需求确认捆绑。

## 本轮发布收口（2026-11-22）

上述v1–v3是早期候选历史，不曾被补造批准。本轮真实宿主计划展示并确认D01–D07、六文件生成范围和隔离验证动作，采用显示标签“当前请求人”项目内保存一次；不授权真实公告发布、公共发布或全局配置改写。

- 新confirmed四输入在 `evals/reverse-requirements/smsnotice-release/`，私有输入hash=`569170e4ffa6ffa1d78868436f754b82ecee9ad69dbc44d120b5177e68885783`。公开生成只复制需求/契约，并剥离决策中的身份/批准内容。
- 首个独立生成使用新上下文，仅公开输入、Skill及准确安装源码；首编译因隔离配置缺少 `@` alias而exit1。原六源码、工具、构建log和失败结果原样封存。
- alias只指向本轮workspace/src，红绿回归后另建同输入 `smsnotice-release-runtime-20261122`，复用原独立源码字节；不是第二次独立生成或新的人点击。当前planHash=`53d3f8ede066301437cb352dc6187bef1a8fa8e5f5321e3d82e14529531264df`。
- runtime首轮构建成功、无warning/error，随后正式保存27项结果：**17pass、6partial、3not-run、1fail**，hash=`f518d2c92f0279b905c1bd8887b91ce5556d39ac42399a89190ae939fd6dc5ea`。唯一fail是确认删除后锁不释放；分页、部分取消/附件/正文/防重视觉和失败场景缺观察均没有强行计pass。
- 首轮完整封存后才启动唯一repaired；只修NoticeList的删除确认锁释放，其余五源码和两公开输入逐字节不变。新manifest=`de9bb001f276e8ccddddff8c451f20128d48a3c26d8b27f0fae6af46463baf8f`，构建exit0、无warning/error。
- 当前演练为 [127.0.0.1:18733](http://127.0.0.1:18733/) 的repaired静态产物，GUI复验另记新result；18731保持不变。输入管线故障和截图超时属于工具限制，也如实留痕，不用JS预触发业务动作代GUI。
- 本机框架版本仍为Vue/compiler2.6.12、fb-ui1.1.840、fb-core1.1.824、TP2.2.16；新两轮source/build/result都有本机原始证据。

最终验收状态以 [验证报告](../validation.md) 第10节、`.validation-output/reverse-requirements/smsnotice-release-runtime-20261122/<round>/result.json` 和报告为准。mock通过不等于真实鉴权/文件服务、业务DB、旧页像素1:1或总体准确率；本档案不把已完成的准备工具提升为这些验证。

