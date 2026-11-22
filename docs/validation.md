# 本地验证报告

日期：历史基线为2026-11-21，最新收口为2026-11-22；环境为 Windows / Git Bash。结果分层记录，**不是“全栈已验收”**。第1–9节保留当时状态，不能把其中“尚未执行”当最新结论；本轮结果见第10节。

## 结论（前一阶段基线；后续增量结果见第 7–9 节）

- Skill 产品工具、结构与本地分发检查已通过；前一阶段 Node 18.20.8 和 24.16.0 全套各 **125/125 pass，0 fail，0 skip**。
- 无额外 parser/安装源码环境：**113 pass，0 fail，12 skip**。跳过项写明原因，不算执行通过。
- 独立生成的 PC / 大屏 mock 演练已编译并做浏览器交互。首轮大屏主题误用、缺轮询、CSV 防护缺口没有被隐藏；整改后另行验证。
- TA/native、准确新版 Java 完整工程、数据库执行、真实业务联调及宿主自动触发仍未验证。
- 无真实消费者项目 apply、数据库连接、git commit/push 或远端发布。模拟身份/批准只验证工具机制，不授权真实项目。

## 1. 工具回归

| 测试文件 | 数量 | 实际覆盖 |
|---|---:|---|
| `detect.test.cjs` | 8 | 工程分型、安装/锁/声明分列、hoisted、配置不执行、覆盖预算与越界 |
| `catalog.test.cjs` | 13 | 本地 Pascal/kebab/camel、拥有者歧义、hoisted、两个副本版本隔离、缺源 unresolved |
| `identity.test.cjs` | 13 | 候选不自动认人、确认/覆盖/失效、Git 邮箱不读取、SVN 仅元数据、隔离全局档案 |
| `workflow.test.cjs` | 23 | 不可变计划、批准哈希/项目根绑定、修订失效、追加链、并发、CLI 拒绝旁路 |
| `guard-review.test.cjs` | 13 | 档案改动、Junction/NTFS 路径、旧锁不偷锁、坏链拒修订、公开事件不冒充批准、失败/无证据不标通过 |
| `install.test.cjs` | 23 | scan 零写、批准 API 集成、精确清理、强锚、保留自定义/链接/硬链接、更新备份、漂移、未受管元数据不覆盖、失败退出非零 |
| `artifacts.test.cjs` | 6 | 受限 frontmatter、链接/测试产物检查、归档保留与幂等、假 pass 拒绝 |
| `archive-integration.test.cjs` | 3 | 实际工作流 API 与归档集成、保留旧内容、方案/目标变化拒绝、操作者留痕 |
| `runtime-fixture.test.cjs` | 15 | mock 契约、CSV、主题机制、contain、30 秒定时器/同引用监听清理、安装源码反证、测试源与浏览器源防漂移 |
| `usage-guard.test.cjs` | 8 | 不禁合法 raw 上传/原生 click、缺 parser/解析失败不假绿、JS/TS/SFC TS、链接未扫描明确失败 |
| **总计** | **125** | 各层范围不互相代替 |

复现（仓库根；`FBJS_DEPS_ROOT` 必须是已核实的 Vue 2 依赖根，不自动安装）：

```sh
FBJS_DEPS_ROOT="<已核实依赖根>" npm test
npm run check
npm run pack:check
```

本轮显式依赖根为用户给定 SOL07：
`D:/projects/SOL07_FMKS_docus/MINE_CODE/gov/trunk/mine-gov-ui`。

最终日志保存于本地 `.validation-output/`（不进分发包）：

- `final-node24-with-source-20261121.log`：125 pass / 0 fail / 0 skip，exit 0。
- `final-node18-with-source-20261121.log`：125 pass / 0 fail / 0 skip，exit 0。
- `final-node24-no-source-20261121.log`：113 pass / 0 fail / 12 skip，exit 0。5 项 catalog、5 项 usage guard 需要 parser，2 项 screen-base 安装源码反证需要显式依赖根。

Node 20.11.1 检查**未启动**：本机目录为指向不存在的 `v16.20.0` 的链接，命令退出 127（`No such file or directory`），不是测试失败。未修改用户 Node 安装；CI 已配置 18/20/24，但未执行远端 CI。最低声明为 ≥18.17；本地实际验证的 18 系列是 18.20.8，不虚报精确 18.17 已跑。

## 2. 结构与分发

`npm run check`：exit 0。三个入口：

| Skill | 行数 | 字节数 |
|---|---:|---:|
| create-fb-feature | 90 | 6120 |
| use-fbjs-vue2 | 66 | 3977 |
| manage-fb-skill | 49 | 2802 |

入口受 150 行 / 20KB 预算约束，references 按需求读取。package/plugin/bundle 版本同为 0.2.0，三个 Skill 整套包含 44 个文件。

`npm pack --dry-run --ignore-scripts`：exit 0；清单仅含 bin/skills/docs/check/README/CHANGELOG/plugin/package，共 57 个文件。**不包含 tests/fixtures/evals、`.validation-output`、node_modules、旧手工 zip、业务源码或旧 rules 正文**。保留 228 个旧路径的指纹与来源记录，仅用于精确清理。npm 的旧用户镜像配置 warning 未改动。

用户给定 SOL07 实际项目只读 scan：44 create、0 conflict；旧指纹 228 absent，0 清理候选。没有生成消费者安装方案或执行 apply。实际 install/update/clean apply 只在隔离临时测试目录发生。

`git diff --check`：exit 0；Git 有本机 autocrlf 提示，没有据此改用户 Git 配置。旧 fb-rules 仓库保留初始未跟踪 zip/lock，不做清空。

## 3. 独立生成与构建

取证/运行依赖严格使用 SOL07 实装：Vue/compiler 2.6.12、fb-ui 1.1.826、tp-components 2.2.15、screen-base 1.0.81。没有借另一份 Vue 2.7 副本凑通过。

独立 Agent 从短需求生成 `List.vue`、`views/add.vue`、`Screen.vue`、`mock.js`。人工复核发现并记录：

- D1：全局 theme 值误用为 Panel 局部 theme。
- D2：需求要求 30 秒轮询，首轮只有 resize 清理。
- D3：CSV 只有引号转义，未处理公式前缀。
- D4：仅注册部分 ScreenBase 组件，不是完整业务启动。
- 后续视觉检查发现宿主顶部栏 + `100vh` 引发溢出，改为剩余高度。

这些是**首轮未通过的事实**，整改后结果不倒写首轮合格。

初 Rsbuild 1.7.5 构建失败：旧 Less 运算与 Vue SFC template 链接不兼容；没有修改参考 node_modules。改用目标已安装的 Webpack 5 / vue-loader 15 隔离配置，构建 exit 0。最后可复现构建用时 5022ms，4 条旧 fb-ui `glyphs` 命名导出 warning 保留。不是业务 Application、登录/代理和完整真实工程构建。

演练源码及重放脚本在 `tests/fixtures/runtime-smoke/`（仓库测试区域，不进 npm 包），不依赖 Junction：

```sh
FBJS_DEPS_ROOT="<已核实依赖根>" node tests/fixtures/runtime-smoke/build.cjs
node tests/fixtures/runtime-smoke/serve.cjs
```

输出 `.validation-output/runtime-smoke-replay`；服务只监听 `127.0.0.1:18732`，没有 API 代理，缺依赖/产物明确拒绝。本轮浏览器交互在先前同源码的工作演练 [127.0.0.1:18731](http://127.0.0.1:18731/) 上完成；不能把重放服务也称为已做浏览器验收。

## 4. 浏览器实际观察

全部合成 mock，不是真实设备需求，也没有真实业务批准。使用宿主浏览器与目标安装组件。

### PC

- 初始两行、按名称查询一行、重置恢复两行；list 计数 1→2→3。
- 实际 `TpDialog.show(import(...))` 异步加载表单；没有依赖不存在的 meta prop。
- 空名称保存出现必填提示，save 保持 0，不发请求。
- 取消关闭，list 不增长。
- 开启失败模式保存：save 0→1，错误提示与弹窗内容保留，list 不增长。
- 关闭失败模式后成功保存：追加第三行，save 1→2，list 3→4，关闭弹窗，恰一次刷新。
- CSV 按钮触发真实浏览器 download 事件；未从浏览器下载对象读取文件字节，CSV 转义/公式前缀由单测另验。
- 最后构建再次验证异步弹窗及成功新增；见原始浏览器轨迹。页面 `__fixtureErrors` 最后为空。

未测真实权限、编辑/删除/详情、接口联调、用户原型像素一致性；简单列表不代表所有 PC 页面合格。

### 大屏

- 挂载：pollStarted=1、resizeBound=1；间隔参数 30000ms。
- 真实自然到点：挂载 `09:02:17.142Z`，`09:03:53.532Z` pollTick=3；没有通过 debugTick 冒充等待。
- 切主题实际写 `html.theme-sky-blue` / `theme-midnight-blue`；视觉为 fixture 自定义 CSS，**不是框架 theme/*.less 的验收**。
- 手动刷新增加一次 mock 请求，不新建定时器。
- 退出 `09:06:48.727Z`：pollCleared=1、resizeUnbound=1、themeRestored=1，调试句柄删除；`09:07:51.163Z` 旧 pollTick 仍为 9，resize 计数不增长。
- 修复剩余高度后，1280×720 宿主内容区 1280×676、scrollHeight=676；960×540 内容区 960×496、scrollHeight=496，均无额外滚动条。contain scale 分别约 0.6259 / 0.4593。
- 两个统计 Panel 与 CSS 条形实际渲染；截图只证明本 mock 布局，不是 ECharts/地图/播放器或所有大屏主题验收。

## 5. Java / SQL / 移动端

实际 `topinfo-platform-common@2.2.0-SNAPSHOT` JAR 的 `ResponseContractProbe` 以 `javac --release 8` 编译并执行，exit 0：`buildSuccess.code=1`、`SUCCESS.ordinal=0`、`SUCCESS.getCode=1`、`buildFailure.code=-1`。SLF4J 无 binding，采用 NOP logger warning 保留。**这是局部响应工厂验证，不是最新 2.2.3 或 Java 业务完整编译**。

已只读取证真实 pom / Controller / Service / Mapper / XML / MySQL 与达梦 DDL；不统一推断 BaseEntity、逻辑删除/主键/日期制度。详见 [证据](evidence.md)。

| 未执行项 | 原因/边界 |
|---|---|
| GMRHCP 准确版本 Java 完整编译/运行 | parent 2.2.3-SNAPSHOT 等准确依赖未齐；JDK17 的局部 --release8 不替代工程依赖验证 |
| TA-UI 包级 API、uni H5/App/native 构建 | 目标主 App 有锁定版本，但本地 node_modules 缺失；不拿 PC FB 包替代 |
| MySQL/达梦 SQL 执行与迁移 | 未连数据库、未申请数据变更权限；只读 DDL 与方言材料 |
| 真实接口/登录/权限/事务/回滚 | 本次 browser 为 mock、未启动业务后端 |
| Skill 宿主发现、自动触发与 plugin 安装 | 仅结构/描述/复制机制检查，未做相应宿主平台实测 |
| with/without 对照、触发准确率、长期稳定性 | 只有少量独立演练与工具回归，没有统计样本；`evals/scenarios.json` 是后续场景集 |

## 6. 旧样例与批准边界

早期 `.validation-output/e2e-test` 设备报废例为助手手写静态演练：模板/JS解析 5/5、窄 guard 无新命中；未跑 Application/后端/数据库/原型验收。旧合成姓名、同意及13:05—13:16时间线不是人批准，已明确纠正，虚构全局身份档案已失效。

本轮用户“继续”授权 Skill 实现和隔离测试，不等于实名批准任意消费者计划。本地档案/哈希链防误操作，但不能向宿主鉴别人身份、签名或阻止绕工具直接写文件。测试输入不构成真实用户消息，工具/Agent 通知也不能补齐批准。

## 7. 反推试点准备工具（2026-11-21，阶段记录）

当前公告案例是**候选输入 v1，未获当前需求确认、未生成、未做页面对照**；不把本节工具回归称为“公告功能通过”。总体计划只批准准备材料与工具，D01-D07 的 confirmation 仍为 null。

资料准备完成：R01-R12、12 条公开契约、7 个待确认选择、27 条验收检查和 6 类未执行范围；11 份准确 GMRHCP 源文件 SHA-256/bytes 实际复核一致。来源包括列表/新增/阅读页/service/router、页面布局、表默认包装及附件读取/提交链。字段长度/真实后端返回/鉴权/文件生命周期仍未验证。

新增 `reverse-requirements.test.cjs` 的第一批 11 项只覆盖 prepare/check/record 的公开工具边界。逐 slice 曾实际失败再修复：CLI help 无输出、prepare/check 尚无入口、record 入口尚未接通；旧 7 项基线始终保留。回归中的身份/批准仅在 os.tmpdir 的合成 fixture，未向真实 profile 或案例写批准。

独立复核后来发现整改输入未绑定首轮、记录二次读取漂移、部分写/短写、决策确认误绑定和审计归属等盲区，逐项新增公开边界回归后修正；完整新增文件现为26项。文档哈希不自动证明外部证据源有效，check 明示 sourceVerification=not-run/readyFor=supplied-result-recording-only。当前案例外部指纹是另行真实核查，不提高工具的默认能力。

代理复核只在临时目录使用合成身份/批准。其临时 fixture 清理因通配删除越出必要只读范围被停止；未继续删除，残留临时 fixture 不作为真实审批，代码/用户 profile 未改动。

| 实际日志（`.validation-output/`） | 结果 | 退出码 |
|---|---|---:|
| reverse-preparation-node24-source-pass1-20261121.log | 136 pass / 0 fail / 0 skip | 0 |
| reverse-preparation-node18-source-pass1-20261121.log | 136 pass / 0 fail / 0 skip | 0 |
| reverse-preparation-node24-nosource-pass1-20261121.log | 124 pass / 0 fail / 12 skip | 0 |
| reverse-preparation-final-node24-source-20261121.log | 151 pass / 0 fail / 0 skip | 0 |
| reverse-preparation-final-node18-source-20261121.log | 151 pass / 0 fail / 0 skip | 0 |
| reverse-preparation-final-node24-nosource-20261121.log | 139 pass / 0 fail / 12 skip | 0 |

带 source 的上述工具回归仍显式采用前一阶段已验证 SOL07 依赖根，便于旧 catalog/guard/screen 反证回归；**没有用 SOL07 构建本公告试点，也没有替换公开的 GMRHCP runtime**。12 跳过项原因和前一阶段相同，不算通过。Node18 实际为18.20.8，Node24 为24.16.0；Node20本轮仍未启动。

`npm run check` 与 `npm run pack:check` exit 0。`docs/.npmignore` 排除反推研究与当前试点档案；evals/新研发评估脚本/tests/隐藏证据不在包清单内，dry-run 仍为57文件。用户原有 npm mirror warning 保留，不改配置。旧实际 tgz 没有重新打包，**不声称它包含本次源码改动**。

第一次直接 `npm --prefix ... pack --json` 在当前 shell 实际选中了另一包 `1.1.495`（389 文件），因此该输出作废、不用于 FB Skill 验证；改用明确的 `npm --silent --prefix ... run pack:check -- --json` 后，先核验 name=fb-skill/version=0.2.0，再确认57文件及研发材料零泄漏。有效初次清单是 `reverse-preparation-pack-script-pass2-20261121.json`；最终检查清单为 `reverse-preparation-final-pack-20261121.json`，仍 name=fb-skill/version=0.2.0、57文件、研发材料零泄漏。未改另一包或生成实际 tarball。

工具仅校验输入/记录调用方证据，不生成、不自动评分、不执行隔离。实际生成前还要在当前输入确认后固定干净工作区/源码文件清单和当前方案批准；当前结果文件清单不是源码写权限。未进行业务浏览器/接口/数据库验证，当前18731页面也未改。

真实案例仅登记候选 `smsnotice-pilot-v1` v1，并实际运行 check：退出 3、ready=false，原因 NOT_APPROVED 与 D01-D07 DECISIONS_PENDING。输入哈希见试点档案，没有创建该案例生成输出或写入批准。这是预期门禁状态，不是运行失败或生成成绩。

## 8. 生成环境与精确范围准备（2026-11-22）

本轮按批准的准备计划新增生成范围、空工作区公开输入复制、源码封存、独立目标构建与loopback静态服务；**没有生成公告页面，也没有当前需求/显示名确认或真实案例批准**。测试只在 os.tmpdir 使用极简合成 Vue SFC 和合成临时批准，原项目/node_modules/18731页面不改。

### 工具边界与实测

- prepare 的 `--scope` 将 first/repaired 的精确源码、输入、构建/服务日志、证据和结果路径写进新计划修订，四输入和工具内容绑定；不创建工作区、不填源码假哈希。
- start 仅在当前输入与范围获批时复制公开 requirements/contracts，隐藏 acceptance/evidence 不进入 workspace；freeze 再核实际文件集与字节，拒额外/缺失/链接/漂移，清单 wx 不覆盖，半写如实 blocked。
- 目标构建使用准确 GMRHCP 包，Vue/compiler2.6.12、webpack4.47.0、vue-loader15.11.1；FB/TP版本按公开契约核验，不执行原业务启动/Babel/PostCSS配置、不自动安装、不落缓存。单app.js+自有index.html，资源内联。
- 真实编译极简合成 SFC 成功；语法失败、异步期间源码漂移、同轮并发、报告短写都有实际回归，失败报告与原始log留痕，不倒写通过。
- 静态协议 GET/HEAD实际请求验证两份资产/字节；未列路径、API/POST、穿越、篡改资产、端口占用与日志硬链接均拒绝。只用临时loopback端口，没有启动真实案例18733或接触当前18731。
- first/repaired实际分目录构建与记录回归；改写原报告/源码/log会被拦，不把换输入/换题当整改。
- 访问范围声明与编译模块围栏不等于OS沙箱；不会自动捕获所有AI工具访问。没有官方浏览器公告质量、真实接口、DB、文件服务或像素对照证据。

本轮首批 `reverse-requirements.test.cjs`40项、`reverse-runtime.test.cjs`20项。收口后分别42项和22项；新增执行工具副本一致性、编译中record拒绝、runtime版本map必填与未构建/失败构建不登记pass。先红后绿中已真实复现并修正：同轮重复异步编译、源码漂移错误通过、FB运行包漏查、日志链接/报告短写、原始报告及构建log变化后仍能整改。一次失败测试因漏关闭意外启动的临时server挂起，被停止后给测试补必关清理；不是成功执行，最终另跑完整回归。

| 实际日志（`.validation-output/`） | 结果 | exit |
|---|---|---:|
| generation-preparation-node24-source-20261122.log | 185 pass / 0 fail / 0 skip | 0 |
| generation-preparation-node18-source-20261122.log | 185 pass / 0 fail / 0 skip | 0 |
| generation-preparation-node24-no-extra-root-20261122.log | 173 pass / 0 fail / 12 skip | 0 |
| generation-preparation-final-node24-source-20261122.log | 189 pass / 0 fail / 0 skip | 0 |
| generation-preparation-final-node18-source-20261122.log | 189 pass / 0 fail / 0 skip | 0 |
| generation-preparation-final-no-extra-root-20261122.log | 177 pass / 0 fail / 12 skip | 0 |

Node版本仍24.16.0与18.20.8，Node20未执行。额外 `FBJS_DEPS_ROOT=SOL07` 只供旧catalog/guard/screen基线回归；**新reverse-runtime始终从公告公开contracts读取准确GMRHCP根**，不靠SOL07编译，也不声称所有依赖源码测试已在无本机源码环境运行。未设额外根时12个旧source-dependent项目跳过，新GMRHCP构建测试因本机目标存在而实际执行；目标不存在时它们会显式skip。

真实案例只登记包含生成范围的候选v2：`inputHash`仍为待确认v1输入指纹，批准数0，check-generation(start)退出3、NOT_APPROVED+DECISIONS_PENDING。准确根source hash准备复核与v2记录见试点档案；不存在真实案例workspace/src、dist或验收结果。

研发fixture/scope/评估工具/tests继续排除分发，旧实际tgz不重建；本轮没有commit/push/npm发布。测试代理残留的临时smoke文件目录没有继续清理，所含批准全为模拟，不作为当前用户留痕。

本轮 `npm run check`、`npm run pack:check`、`git diff --check` 均exit0，dry-run初次`generation-preparation-pack-20261122.json`及最终`generation-preparation-final-pack-20261122.json`实际核name=fb-skill/version=0.2.0/57files/研发材料零泄漏。npm镜像旧warning与autocrlf提示保留；这些不改变上述已实跑测试的结果。候选v3最终门禁与审计证据为`generation-preparation-final-evidence-20261122.json`，批准0、无真实案例输出。

## 9. 显示名一次登记后复用（2026-11-22）

用户明确要求显示名自动获取或首次补充，写过一次就记住，不每个需求重复填写。本次修正有效档案的读取路径和引导，**没有替用户保存真实显示名，也没有批准或生成公告案例**。

- `readIdentity/loadIdentity` 返回有效 `operator` 时直接复用项目/全局档案，不再收集 Git/SVN/OS 候选；仅无有效档案时自动收集候选。读取不修改原确认、hash 或 revision。
- 项目档案优先；已确认全局档案可跨工程复用。损坏、旧未确认、失效、fixture 档案仍拒绝自动认人；首次保存与更新的原有校验不放宽。
- 主 Skill、管理 Skill、README、需求/归档指南、CLI 提示与试点待办均明确一次登记和当前方案批准分开。有档案不重复问姓名或 `--save`，没有档案先核对实际工程根；新方案仍需本次真实批准。
- 身份公开接口新增两项回归：重复读取不产生外部候选、不改变原确认；全局档案跨项目复用且项目优先。原有13项全部保留，本文件现为15项，均只用隔离临时档案。

首个新增检查在修改前实际失败（外部 OS 候选仍被返回，exit1），随后最小修正后通过；完整回归另跑，不将首次失败改记通过。

| 实际日志（`.validation-output/`） | 结果 | exit |
|---|---|---:|
| identity-reuse-node24-source-20261122.log（引导收口前） | 191 pass / 0 fail / 0 skip | 0 |
| identity-reuse-final-node24-source-20261122.log | 191 pass / 0 fail / 0 skip | 0 |
| identity-reuse-final-node18-source-20261122.log | 191 pass / 0 fail / 0 skip | 0 |
| identity-reuse-final-no-extra-root-20261122.log | 179 pass / 0 fail / 12 skip | 0 |

Node24.16.0、Node18.20.8 实际执行；Node20仍未执行。额外SOL07根仅用于原catalog/guard/screen检查；新极简Vue构建仍使用本机准确GMRHCP，12跳过项含义不变，不声称无全部源码依赖。

结构检查 `identity-reuse-final-structure-20261122.log` exit0：create-fb-feature90行/6273bytes、use-fbjs-vue2 66行/3977bytes、manage-fb-skill49行/2910bytes，整套仍44文件。dry-run `identity-reuse-final-pack-20261122.json` exit0，实际核name=fb-skill/version=0.2.0/57files，身份工具与指南在包内，研发/隐藏材料未泄漏；这次单独stderr日志为空，未修改npm配置。`git diff --check` exit0，原autocrlf提示保留。

没有覆盖前一阶段日志/候选计划、读取或写入真实用户profile、写真实approval、创建公告生成输出、改18731页面、修改参考项目/node_modules、commit/push或发布；现有实际tgz/zip未重建，不声称已包含本次修正。

## 10. 发布收口增量（2026-11-22）

本节是本轮最新状态；前9节保留各历史阶段当时事实。所有业务样例仍为合成数据，不把工具回归或mock页面称为完整全栈验收。

### 10.1 实际批准、身份与审计

- 本轮真实 `ExitPlanMode` 批准了已展示方案及D01–D07，日志标签“当前请求人”只在项目内首次保存一次，不宣称实名；未写全局身份。来源记录保留原计划原文/哈希、宿主结果与脚本录入时间。
- 本地派生 scope 绑定本次工程、修订、文件/验收/metadata，不声称宿主直接返回这些机器哈希；普通工具、代理通知不属于批准。
- 修复跨工程复制的host-plan身份重放、宿主/聊天参数混用与无 `--save` 静默忽略确认材料；普通已确认全局身份的跨工程复用不受影响。
- 审计 `--details @file` 只读取当前工程内相对文件；原批准/计划/失败记录保留，源码回放使用原始Buffer。对应公开接口先红后绿并完成独立只读复审。
- 仍是本地防误操作与追溯，不是IAM、数字签名、OS硬隔离或全量操作捕获。

### 10.2 同套最终本地回归

源码仓库命令：`node scripts/run-release-regressions.cjs <node18|node20|node24> <新输出id> <with-source|no-extra-source>`。使用实际Node安装路径，不修用户nvm。日志和不可变JSON位于 `.validation-output/release-validation/`：

| 新输出目录 | 实际版本 | tests | pass | fail | skip | exit |
|---|---|---:|---:|---:|---:|---:|
| final-regression-20261122-01/node18 | 18.20.8 | 243 | 238 | 0 | 5 | 0 |
| final-regression-20261122-01/node20 | 20.19.6 | 243 | 238 | 0 | 5 | 0 |
| final-regression-20261122-01/node24 | 24.16.0 | 243 | 238 | 0 | 5 | 0 |
| final-regression-no-extra-20261122-01/node24 | 24.16.0 | 243 | 225 | 0 | 18 | 0 |

- 同套有源回归的5跳过：历史Java参考slice、移动H5、native、真实MySQL执行门控、达梦运行门控。MySQL另有下面实际执行报告，跳过不因此改计pass。
- 无额外根增加13跳过：5 catalog、5源码守卫、2旧screen-base源码反证、1新大屏准确安装版本检查。准确GMRHCP反推构建及本地大屏产物因当前机器具备环境仍被使用；“无额外根”不等于“完全没有参考工程/已有产物”。
- 有源模式 `FBJS_DEPS_ROOT=SOL07` 仅旧parser/守卫；`FB_SCREEN_DEPS_ROOT=GMRHCP` 为新大屏；公告构建从公开contracts确定准确GMRHCP，互不替代。
- Node24首个启动被no-links检查拒绝nvm junction，未开始测试；随后用实际安装路径执行成功，原失败输出保留。
- 官方便携Node20 zip与已下载官方SHASUMS256逐字匹配：`650f9a0b46871f25f6efeb17d9ea5e8e58cf0cfd86c8e8676db6569a7bb34a34`。未修坏的20.11.1链接；远端CI未执行。

### 10.3 公告独立生成及浏览器

- 新confirmed案例 `evals/reverse-requirements/smsnotice-release/` 使用独立上下文，仅公开需求/契约、相关Skill和准确安装源码。生成方没有获得隐藏acceptance/evidence或旧公告模块；访问声明不是OS硬隔离，不能由单案例推总体准确率。
- 原 `smsnotice-release-20261122` 首轮实际编译exit1：安装的两套Dialog含 `@/views` 动态import，而隔离配置未声明 `@`。保留完整失败、工具原字节与不可变首轮结果。
- 修 `@` 仅指向隔离workspace/src，经红绿回归后另建 `smsnotice-release-runtime-20261122`。四份输入hash不变，复用原六份独立生成源码字节；不是第二次独立生成，也不是新的用户点击。
- 新runtime首轮实际构建exit0，错误/警告0；服务只在 [127.0.0.1:18733](http://127.0.0.1:18733/) 提供固定静态文件，不代理真实接口、不改18731。
- 实际GUI发现成功确认删除后 `confirmingDeleteId` 未清，其他删除入口永久禁用；首轮完整记录为17pass/6partial/3not-run/1fail，resultHash=`f518d2c92f0279b905c1bd8887b91ce5556d39ac42399a89190ae939fd6dc5ea`。首轮源保持冻结，之后在repaired目录唯一修锁；新build成功且仅NoticeList源码hash变化，其他七件完全相同。本轮最终两轮评分仍以对应result.json/报告为准。
- 已看到保存防重、失败保留字段/范围/附件/正文、成功重试一次保存/刷新、陈旧详情变只读。框架调用点/静态检查不替代GUI；真实文件上传、后端鉴权/幂等、业务DB、旧页面像素对照均未验收。
- **repaired轮官方GUI复验最终完成（27项：26 pass / 1 partial / 0 fail / 0 not-run），resultHash=`da7882c8bed624b49c79aa9e4704f3b78d0fb36f1445292c5e090a89f9d846a8`，绑定firstRoundHash/sourceManifestHash/buildReportHash，wx不可覆盖。** A19修复经business-failure（请求参数+按钮全部恢复enabled）与success双路径GUI确认。新增官方验证：A03日历窄区间/空止不约束/倒置阻止、A04双重置回第一页单次查询、A05类型精确过滤、A06真实第2页、A20挂起期双击一次请求、A21/A22发布失败保留零刷新+成功重试X5602、A25脚本标记惰性文本、A15阅读页仅关闭。A27=partial：查询期business-failure/reject保留旧记录已官方验证；初始加载失败分支因公开mock控制接口不跨页面reload持久化而无法注入失败，属harness限制如实记录，非应用缺陷断言。发布失败场景正文含一行非本会话来源的手动文本，保留未清并在evidence披露。复验期间视口曾两次临时调高至800px以触达视口外分页/底部控件后恢复720px；全部操作为官方指针/键盘事件，rawCDP两诊断仅diagnostic不计分。
- 复验过程中官方IAB输入出现技术故障；曾误用独立Chrome原始调试通道，主核官方能力后立即中止，单独保留 `announcement-browser-02/METHOD-DEVIATION-rawCDP-record.*`，两条删除诊断观察不计正式GUI通过。主随后用官方IAB唯一按钮点击实际打开表单，交回官方通道复验；不把方法偏离洗成验收或policy许可。

### 10.4 大屏实际运行

`screen-repaired/build-attempt-02/browser-agent-01/report.md`、`observations.json`、19文件source-hash清单、7张实际截图保存于本地验证输出。**8/8 GUI检查pass**：真实两主题可逆、ECharts与合成GeoJSON canvas、刷新一次、自然30秒轮询、缩放、卸载清理、超过30秒不再增长、重新挂载新owner。Node20大屏专项18/18pass不是完整套件总数。

保留首轮主题/过渡/布局失败、attempt-01、工具超时与页未聚焦节流；工具栏canvas=0早采样诊断值DIAG-1未修，不冒充实际图表状态。真实地图瓦片/视频播放器未测。

### 10.5 MySQL实际合成实例

`sql/mysql-runtime-20261122-03/report.json`：MySQL **5.7.26，127.0.0.1:18735，26项全部pass，exit0**。真实执行DDL、自增/重复主键、唯一、NOT NULL/NULL、日期毫秒、多个NULL、分页、影响行、decimal、commit/rollback；测试进程退出code0，端口已释放。全部datadir/log保留；随机凭据仅子进程输入/环境，不落凭据文件；`MYSQL_TEST_LOGIN_FILE` 指向本轮永不创建的路径，防5.7登录档案注入。

旧01因OS监听无法确认exit1、02因关闭端口后50ms即检查进程退出过早exit1，都保持原样；03等待实际ChildProcess退出，不能以端口释放替代退出。

绑定依据是自身准确mysqld启动日志中的PID/IPv4 socket/port，以及运行时 `@@version/@@port/@@bind_address/@@datadir` 对照。当前宿主OS表也看不到已独立确认活跃的本机测试listener，报告明确 `osIndependent:false`；**不宣称OS独立socket验证**。

### 10.6 达梦实际尝试：监听边界失败，停止而非放宽

`sql/dm-runtime-20261122-04/report.json` 是最终实际尝试记录：DM8 `03134284094-20231109-208042-20067 Pack10`，本机许可到2026-12-06；新合成datadir、固定18736，启动前 `LISTEN_IP=127.0.0.1`、`IPV6_LSNR=0`，运行时 `V$DM_INI` 回读也精确一致。自身PID73208、版本与datafile路径均确认。但127.0.0.1及三个非环回本机地址的TCP连接都实际保持3.5秒；未开的59999端口基线拒绝。**配置文本与回读不能代替实际绑定；该环境未满足仅本机约束，正式status=fail/aborted=true，18项必要SQL检查未执行。**

只停止自身ChildProcess（SIGTERM），端口释放；正式01–04的原报告/命令日志/datadir保留。04内部hash=`81145e1d7a467a286cdff922122aea54b92b4b12f3884a149fe0a00d7a34e555`，报告文件SHA-256=`87c40beaf727c2fb1259c7f33a1975c3eaaba9bbab03f2ae9d0da4997090e218`。不改防火墙/服务、不降级绑定门禁、不绕许可；没有把MySQL结果当达梦结果。

事后运行器审查补齐disql错误通道、配置与实际绑定区分、必需步骤完整性等纯Node回归，并修正默认口令负测通道及清理结果硬编码；**没有为修正后的运行器再启动数据库，因此纯测试不代表达梦方言通过。** dminit初始口令只能暂时在argv传输，日志脱敏不消除瞬时进程列表暴露。

方法边界另记 `sql/METHOD-DEVIATION-dm-probes-20261122.md`：执行分支曾在temp/额外目录和非批准端口做合成诊断，之后删除探测原始日志；一个未读共享日志的生产者不能精确确认。主已停止进一步尝试，不把附加诊断追认为批准动作或完整证据。正式03/04共享服务器日志已完整转存，02缺共享日志副本。此次范围和证据保留偏离如实记录，不称全程无偏离。

### 10.7 移动与准确Java：硬阻塞不计通过

- 移动 `mobile/status-20261122.json`：锁定Vue/compiler2.7.16、TA-UI0.1.170、ta-js0.0.18、ta-theme0.1.18和uni-h5准确版本；已在空目录有界尝试npm ping/ci，分别exit1 socket hang up/ECONNRESET。内部npm仓库（内网地址从公开文档略去，见本地status报告）不可达、无缓存；未建TA页面/H5产物。没有可用HBuilderX，native未执行；不换成PC FbUI或相近版本。
- 准确Java `java/summary.json` 与原log：6项缺依赖探测0resolved，目标2.2.3 parent/platform未恢复。关联旧2.2.0模块build失败，不能替代2.2.3；该日志reactor只显示6行（含聚合器1SUCCESS、5FAILURE），不是“16个业务模块通过”。准确业务编译/Spring/MyBatis/真实事务仍blocked。
- 最小纯JDK合成Controller→Service→Mapper样例真实编译 `--release 8` 和运行，43/43pass；XML只是文本映射检查，无Spring/MyBatis运行时或真实DB。最终同套回归显式提供JDK17，保留classes和新02证据。
- 默认测试不加载gitignored旧Java参考fixture，也不写历史summary；fresh-clone子进程不含旧fixture仍执行合成静态检查并明确skip运行，避免靠本机隐藏源码凑绿。

### 10.8 消费者、宿主与分发边界

本轮实际tgz包已做到包清单/结构/逐文件字节与审查源码相等；研发/隐藏材料、业务源码、旧zip不在包中。`consumer-pack-05` 的58文件实际包在 `consumer-smoke-03` 全新消费者离线安装成功：npm exit0、44Skill文件安装、1个精确独占旧文件清理、未知旧规则和自定义Skill哈希保持、重复安装与安装包CLI version/scan exit0、审批链校验通过。最终文档更新后再重包复验；结果只引用新消费者报告，不拿旧包成绩代替新包。

Codex CLI0.167.0实际 `skills/list` 已发现三套项目Skill；显式任务首个读取被host policy拒，随后模型node_repl旁路被主中止。保留 `consumer-smoke-01/host-explicit-interruption.md` 与原JSONL。**发现成功 ≠ 显式流程或自然触发通过**。未代批准、未改宿主策略/全局配置/认证；其他宿主未实测不泛化。

版本0.2.1、private:true、UNLICENSED：只本地内部私有验证包，不授权线上公告、公共npm/GitHub发布、开源许可。未commit/push、创建PR/Release或远端CI。最终就绪结论见 [发布就绪表](release-readiness.md)。

