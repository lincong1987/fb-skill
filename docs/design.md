# FB Skill：源码取证驱动的重做方案

## 目标与本次边界

把 Skill 做成开发流程，而不是组件说明书全集：识别目标项目 → 只查本次需要的契约 → 展示方案 → 真实人批准 → 实施 → 验证并留痕。

用户已明确授权继续重做，可以推翻先前实现，不要求保留旧 rules 的兼容层。本次修改集中在 `fb-skill`；提供清理工具与演练，不无差别删除参考仓库、业务代码、其他 AI 工具配置或旧仓库的未跟踪文件。发布、提交、推送、npm 下线均不在本次授权内。

## 产品结构

- `create-fb-feature`：短工作流入口，按目标/需求读取 PC、TA/uni-app、大屏、Java、SQL 的小型参考。
- `use-fbjs-vue2`：可独立使用的 Vue 2 源码取证与窄守卫，供主工作流调用；无法解析的 API 明示为未知。
- `manage-fb-skill`：安装、更新与清除旧 FB 管理内容；不混入日常功能开发上下文。
- 公共命令在 `create-fb-feature/scripts/`，安装时三个 Skill 作为一套分发。探测、身份、审计、归档和安装只依赖 Node.js 内建模块；Vue 2 源码工具另需目标工程已安装的 parser/模板编译器。本地探测不会执行项目配置文件。

## 规则的证据等级

1. 目标项目实际注册、安装源码、依赖锁定与后端/SQL 契约。
2. 明确指定的同版本上游源码。
3. 项目调用点、文档或旧规则：仅线索，不因“大家这么写”就变成正确 API。

每个契约注明证据文件、版本与仍未知的部分。响应码、URL、日期、主键、审计字段、UI 谱系和大屏比例跟随实际目标；不强迫所有项目迁成单一历史样本。

## 后端团队 ai-playbook 的融合取舍（2026-11-23）

后端团队提供了 `ai-playbook`（61 篇 md）：一套后端开发 SOP + 四份 `topinfo-platform v3.1.0` 框架规范。本 Skill 原有的 `backend-java.md` / `database.md` 只有原则与反模式，没有字段名、注解、错误码——Playbook 的框架规范正好补这一层。

**吸收了什么**：
- 四份框架规范提炼为 `references/frameworks/` 三份：`topinfo-api.md`（响应/分页/鉴权三元组/passKey 成对/错误码分段）、`topinfo-db.md`（表前缀/通用字段/主键/逻辑删除）、`topinfo-versions.md`（**两代对照表**）。
- `detect-project.cjs` 的 `javaUnit` 新增读 pom 的 `topinfo-platform` 坐标与版本，输出 `platform{version, parentVersion, versionExpression, declaredAs}` 与 `java-topinfo-2x/3x-candidate` profile。`${...}` 占位不猜值，只报 `versionExpression`。
- Playbook 里与版本无关的硬规则并入 `pitfalls.md`（鉴权三列、passKey 成对、写接口不列 20008、一码一义、级联删除纪律、超 20 文件报备）和 `output-conventions.md`（交付说明七项映射到现有档案 JSON 字段）。

**没吸收什么，为什么**：
- 八环节两闸门流程（需求卡→HLD→详细设计→表设计→接口卡→计划→编码→复核，每步人工签字）：对"小白 + 一个页面"过重，与现有「方案→批准→实施」重叠。只取其中可核对的硬检查。
- 400 行常驻 `AGENTS.md`、20 个提示词文件、培训材料：与本 Skill"按需加载、不常驻全集"相反。
- 租户层级编码、权限编码总表等 admin 业务专属内容：业务模块不涉及。

**两个技术线，一套开发规范**：Playbook 针对正在开发的新后端 v3.1.0（Java 21 / Boot 3.5），是正式规范和未来主线；本机现行工程全是 2.2.x（Java 8 / Boot 2.2~2.7），技术栈不同但开发规范相通。深核结果：`JsonResponse`（成功码 1）、`buildPassKey`、`@Authorization(businessKey)`、`CommonDateUtil`、`SessionHolder`、`IPage` 两代一致；`@Authorization(perms/logical)`、`DataScopeHelper`、`common.enums.ErrorCode`（2.2.x 在 `bean` 包）、`BlockAttackInnerInterceptor` 在 2.2.x 无证据。因此**现行 2.2.x 工程按"实际代码 + Playbook"处理**：规范层（鉴权三列、passKey 成对、一码一义、分页出参、逻辑删除）照 Playbook，新代码必须遵守、老代码的问题不照抄；实现层照实际 jar/源码，缺的能力先 `javap` 确认，没有就用目标现有手段实现同一规范并记待办。`topinfo-versions.md` 每条"已核实"都有 jar/源码路径对应。

## 移动端团队 ta-app-trae 的融合取舍（2026-11-24）

移动端团队发布了 `@topinfoapp/ta-app-trae@0.0.9`：一份 `project_rules.md` 加两个 skill（生成业务模块、按设计图生成首页），靠 postinstall 装进项目 `.agents/`。本 Skill 原有的移动端参考只有通用原则，缺团队的具体写法。

**吸收了什么**：
- 提炼为 `references/frameworks/ta-app-mobile.md`：目录与命名、列表/新增/详情闭环、字段→控件对照、`txHeight` 换算、图标与上传规则、首页拆区域要点。组件属性逐个对 `ta-ui@0.1.208` 源码核实。
- `detect.cjs` 对 `mobile-ta-uni` 输出 `taApp{uiLine, uiLineSource, teamRules, localComponents, referenceModules}`：自动找到项目自己的团队规则、本地 `ta-/cu-` 组件和可照抄的现成模块，开发人员不用再说“参考某某页面”。
- 可核对的检查并入 `pitfalls.md` 移动端一节。

**版本线**：ta-ui 有两条并行发布线。0.1.x 持续发布（0.1.208 于 2026-11-10），registry `latest` 指向它，团队模板按它写；1.x 停在 1.0.37（2025-10-14）。两版注册表相同，但 1.0.37 删掉了团队模板会用到的 `customResultMapp`、`fileSize`、`@fileExceedLimit`、`lgnoreDelIds` 等属性。Vue 2 对未知属性静默忽略，所以错用不会报错、只会功能失效。探测因此按“实装/锁定版本优先、其次声明”判定版本线，1.x 时给出提醒，读不出时报 `unknown` 不猜。本机 3 个移动端工程均锁定 1.x、均未装团队规则。

**没吸收什么，为什么**：
- postinstall 全量覆盖 `.agents/`：与本 Skill“预览 → 批准 → 只清理指纹一致文件”相反；项目里已有的团队文件归为不认识的内容，原样保留，并由探测提示 AI 先读。
- 每次手输作者名：本 Skill 的显示名登记一次后复用（见下节），`@author` 直接用登记值。
- 写死 `targetshutdown`、`cu-page-frame` 等参考路径：改为探测项目里实际存在的模块与组件。
- “只做 H5”：只在目标项目本身如此配置时遵守，不升格为所有 uni-app 的规则。
- 团队模板自身的缺口（`onShow` 刷新与 `callPreDataFun` 双重请求、修改页只靠 Store 回显、保存无防重）写成“照抄时注意”，不原样复制。

## 可执行门禁与留痕

- 身份只登记一次：有效项目档案优先，其次有效全局档案，直接复用，不重复询问姓名或保存。仅没有有效档案时自动获取 Git/SVN/系统候选，由用户自报/确认后首次持久化；旧无确认、invalidated、fixture 或损坏档案不自动升级。复用显示名不等于批准当前方案。
- 方案为不可变版本，绑定项目根、文件范围、验收条件与 SHA-256 摘要。修订产生新版本，旧批准不授权新方案。
- 批准证据须来自真实用户消息或终端输入，记录引用、原文、批准人及脚本采集的带时区时间；脚本、agent 报告、模拟输入不是批准。
- 提案、批准、实施与验证先后追加到审计链，再生成可读实现档案；失败和跳过也记录。不在收尾补造批准。
- 这是本地审计与防误操作门禁，不冒充企业 IAM、数字签名或不可绕过的安全边界。聊天消息来源真实性依赖宿主与执行人，直接绕开工具写文件不受本地脚本控制。

## 安装与旧规则清理

先生成只读预览，列具体文件与当前哈希；批准针对这份清单。执行时重验清单、批准与文件哈希，发现变化即停止。

自动清理范围仅限确认属于 FB 的旧文件：精确指纹、已识别的独占引导文件或本套安装清单。自定义/混放内容列为需检查，不删除整个 `.cursor`、`.agents`、`.claude`、`AGENTS.md` 或 `node_modules`。不沿目录链接/Junction 递归清理，不自动改锁文件、远端包或 SVN 属性。

## 验证分层

1. 无外部依赖的工具回归：身份候选、拒绝伪造/过期批准、审计追加、防越界、更新冲突、混放内容保留。
2. Skill 结构检查：描述/路由、链接、文件预算、独立安装与 npm 打包清单。
3. 隔离项目的源码取证、模板/脚本编译、独立 agent 需求执行演练。
4. 可用环境内的 PC/大屏浏览器交互、Java/SQL 验证；缺依赖、数据库或运行时明确写为未验证，不以静态解析替代运行验收。

## 先前演练的纠正

先前全局 profile 中的虚构身份已失效化；设备报废样例中的合成审批已标明没有真实批准。旧“E2E 完成”应改称静态演练。业务代码问题仍独立记账，既不直接照抄，也不借重做 Skill 之名去整改。
