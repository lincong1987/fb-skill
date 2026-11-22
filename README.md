# FB Skill

把需求变成符合 **目标工程实际契约** 的实现，而不是把旧规则全集塞给 AI。

- **create-fb-feature**：文字/原型 → 自适应识别 → 按需取证 → 方案批准 → PC、TA/uni-app、大屏、Java/SQL 实现 → 验证与归档。
- **use-fbjs-vue2**：可独立调用的 Vue 2 组件源码取证、拥有者定位与窄守卫。
- **manage-fb-skill**：预览后安装/更新本套 Skill，或逐文件清除旧 FB 管理规则，保留用户自定义内容。

日常只加载主入口和本需求涉及的参考。移动端不是 FbUI；Vue 2.6/2.7、Vue 3、TA、旧 TX 不混用 API。手写参照只给线索，实际源码/注册/版本/后端与 DDL 才能确认契约。

## 开发人员先看这里

[需求与原型提交指南](docs/requirement-guide.md)：不必懂框架，只写做什么、参考、业务限制与数据来源；AI 自己核实能在代码中查到的事实。

示例（虚构业务）：

```text
做设备报废列表和提交弹窗，参考图1列表、图2表单。
查询名称/状态，日期和说明必填，保存成功刷新、取消不刷新。
接口文档在 docs/api/device.md；先给方案，批准后开发。
```

实际宿主支持的显式调用格式不同，如 `$create-fb-feature` 或 `/create-fb-feature`；也可用自然语言让模型识别描述。仅复制文件不保证每个宿主立即刷新 Skill 索引。

## 安装与干净替换

当前 `0.2.1` 是内部私有验证包（`private:true`、`UNLICENSED`），不执行公共 npm 发布，也不默认授予开源许可。最新交付与阻塞见 [发布就绪表](docs/release-readiness.md)。

Node.js ≥18.17；探测、身份、门禁、归档和安装命令仅用内建模块。Vue 2 源码工具需要目标已安装的 parser/模板编译器，不自动联网安装。采用一种安装渠道，不要同时装多份同名 Skill。

### 从本地分发包安装到项目

先预览，不写文件：

```sh
node bin/fb-skill.cjs install scan --project-root "<目标项目>" --action install-and-clean
node bin/fb-skill.cjs install plan --project-root "<目标项目>" --action install-and-clean --id fb-skill-setup
```

默认 `.agents/skills`；宿主使用 Claude 技能目录时可加 `--location .claude/skills`。支持 `install`、`clean-legacy`、`install-and-clean`。三个技能整套分发，内部相对引用不会缺兄弟工具。

先复用已确认的显示名档案；只有没有有效档案时才首次登记一次。用户明确批准本次具体清单后，使用 [批准命令](skills/create-fb-feature/references/output-conventions.md)，再执行：

```sh
node bin/fb-skill.cjs install apply --project-root "<目标项目>" --id fb-skill-setup
```

清理不依赖旧 fb-rules 仍然安装。仅匹配已知文件指纹，修改/未知内容保留，不直接删除整个工具目录、业务代码、锁文件、npm 缓存或 Git/SVN 元数据。旧源码仓库不是消费者项目，拒绝直接 apply。

旧包依赖与 Git/SVN ignore 只报告，不自动卸载/修改。旧 `fb rule` 可能重新装回包，因此清理后不要继续用旧命令更新规则。

已有 Codex plugin 元数据保留为另一分发形态。Codex CLI 0.167.0 已实际发现隔离消费者安装的三套项目 Skill，名称可能带 `fb-skill:` 前缀；发现不等于模型成功调用或自动触发。各宿主按实际名称选择，不把本地复制或单次发现称为平台认证。

## 本地工具

```sh
node bin/fb-skill.cjs detect --project-root "<目标工程>" --target "src/views/<目标页面>"
node bin/fb-skill.cjs identity --project-root "<目标工程>"
node bin/fb-skill.cjs workflow plan --project-root "<目标工程>" --input "<方案JSON>"
node bin/fb-skill.cjs workflow check --project-root "<目标工程>" --id "<任务id>"
node bin/fb-skill.cjs archive --project-root "<目标工程>" --id "<任务id>" --input "<结果JSON>"
```

组件 API：

```sh
node skills/use-fbjs-vue2/scripts/inspect-component.cjs fb-button --project-root "<目标工程>"
node skills/use-fbjs-vue2/scripts/check-fbjs-usage.cjs --root "<目标工程>"
```

探测只读取配置文本，不执行项目 config；锁定/安装/声明版本分别报告。catalog、guard 是窄工具，静态未知须回源码查，不是全量合规、运行或安全证明。

## 真实批准与归档

**显示名一次设置，以后复用。** 有有效项目/全局档案就直接使用，不重复询问或保存；只有没有有效档案时才自动取 Git/SVN/系统候选，由真实人首次确认或补充一次。已失效、未确认、fixture 或损坏档案不自动升级。显示名复用不批准新方案：方案绑定项目、修订和 SHA-256，改方案后旧批准无效。每次批准仍需真实输入来源，时间由脚本采集；没有自动审批开关。

事件实时追加到 `.agents/fb-feature/workflows/<id>/events.jsonl`，再产出可读 `docs/features/<id>.md` 和 CHANGELOG。失败、部分完成与未做验证同样记录。真实全局身份测试已停用，旧合成审批明确失效，不能作为实际批准。

**边界**：本地门禁防误操作并记录证据，不是企业 IAM/数字签名/不可绕过沙箱。脚本不能证明宿主外某段消息的真实性，也控制不了绕开工具直接改文件。组织级强审批应接身份与宿主审核服务。

## 验证与维护

以下回归命令在 **源码仓库** 执行；分发包和消费项目不包含 tests/fixtures。运行演练的可复现入口与缺环境的范围见 [验证报告](docs/validation.md)。

```sh
npm test
npm run check
npm run pack:check
# 如需执行依赖目标 parser 的 catalog 测试，显式借用已核实工程：
# FBJS_DEPS_ROOT="<已安装依赖的Vue2工程>" npm test
# 新大屏使用独立准确根，不用前一变量回退：
# FB_SCREEN_DEPS_ROOT="<已核实的新大屏工程>" npm test
```

[验证报告](docs/validation.md) 区分工具回归、源码取证、静态编译、独立生成、浏览器、后端编译与 SQL 执行；未做不写通过。最新Node18/20/24同套回归无失败，明确跳过项仍单列。新公告/大屏与MySQL、纯JDK合成样例实际执行，不能替代移动端、准确TopInfo工程、真实接口或完整宿主调用；早期设备报废样例只做过静态演练。

- [设计与边界](docs/design.md)
- [真实基线与证据](docs/evidence.md)
- [Skill 写法调研](docs/research.md)
- [独立问题台账](docs/legacy-issues.md)（记录，不在本任务整改业务）

发布包不包含测试、演练、临时输出、旧手工 zip 或参考业务源码；本轮未 commit、push、npm 发布/下线。
