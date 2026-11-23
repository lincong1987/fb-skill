---
name: create-fb-feature
description: FB 全栈开发：在 Topinfo fb.js 项目中把文字需求、原型截图或原型链接实现为 PC 页面、TA/uni-app 页面、大屏、Java 接口或 SQL；先识别目标工程，按需取证，经真实用户批准后实施并记录验证与变更。
---

# Create FB Feature

**契约先行**：识别实际项目，查本次需要的 API，批准方案后实施。不加载全部参考，不把相邻手写代码自动当标准。

`<skill-root>` 是本文件目录。三个 FB Skill 应整套安装；组件工具位于 `../use-fbjs-vue2/scripts/`。工具不可用就说明缺失，不虚报检查通过。

## 1. 识别目标与需求

运行只读探测：

```sh
node "<skill-root>/scripts/detect-project.cjs" --project-root "<目标工程>" --target "<目标相对路径>"
node "<skill-root>/scripts/resolve-identity.cjs" --project-root "<目标工程>"
```

- 父目录含多个工程时选本次目标单元；PC + 大屏同仓库时确认实际入口。探测结果是候选，不证明配置已启用。
- 用文字、图片和可访问链接拆出 **字段、操作、数据来源、业务限制、验收条件**。多图记明对应页面/弹窗/状态。链接打不开就报告，不编造图中内容。
- 代码能查出的目录、组件、字典、接口不用让用户重填；只问会改变实现且无法核实的业务决定。没有明确功能字段时先澄清；普通样式小改不用填写完整 CRUD 表。
- 只读研究不需要开发批准。用户要求不要再提问时，可继续取证/出方案；这不等于自动批准未见过的方案。

**完成条件**：已选目标工程/入口，需求与可核实事实分开；剩余阻塞点明确。

## 2. 按需建立契约

| 本次涉及 | 读取 |
|---|---|
| 输入不清、图片/链接、多页面关系 | [需求引导](references/requirements.md) |
| 响应、分页、日期、权限、数据字段 | [跨层契约](references/shared-conventions.md) |
| PC 列表、表单、弹窗、详情 | [PC 页面](references/pc-page-templates.md) |
| PC service、路由、字典、权限、上传/导出 | [PC 数据对接](references/pc-service-router.md) |
| PC 启动、拦截器、布局配置 | [PC 基础装配](references/pc-infrastructure.md) |
| TA/uni-app 页面、导航、刷新 | [移动页面](references/mobile-page-templates.md) |
| 移动请求、主题、Store、上传、跨端能力 | [移动基础能力](references/mobile-infrastructure.md) |
| 大屏入口、布局、缩放、主题 | [大屏布局](references/screen-templates.md) |
| 图表、轮询、地图、播放器 | [大屏数据与资源](references/screen-data-theme.md) |
| Java 接口、业务、Mapper、测试 | [Java 后端](references/backend-java.md) |
| 表设计、字段变更、DDL/SQL | [数据库](references/database.md) |
| 工程依赖 topinfo-platform（探测报 `java-topinfo-*`） | [TopInfo 接口口径](references/frameworks/topinfo-api.md)、[TopInfo 表约定](references/frameworks/topinfo-db.md) |
| 不确定某条框架规则是否适用当前版本 | [TopInfo 版本差异](references/frameworks/topinfo-versions.md) |
| 准备实施或写留痕 | [批准与归档](references/output-conventions.md) |
| 对应领域的检查 | [验证清单](references/pitfalls.md) |

组件取证例：

```sh
node "<skill-root>/../use-fbjs-vue2/scripts/inspect-component.cjs" fb-simple-table --project-root "<目标工程>"
```

以目标实际注册/安装源码、锁定版本、匹配后端与 DDL 为契约。调用点和上游默认只提供线索；找不到 API 就缩小到已证实能力或标阻塞。Vue 2.6、2.7、Vue 3、TA 与旧 TX/ColorUI 不互借契约。

**完成条件**：本次使用的组件/方法、服务命名空间、响应/日期/主键等字段与真实来源对得上；未验证部分明列，不声称已确认。

## 3. 最终方案与批准

展示短方案：目标文件、字段/交互、接口与权限、验证办法、未就绪依赖、关键取证来源。普通小改按实际缩小范围。

身份工具返回非空 `operator` 时直接复用已保存显示名，不再询问或重复 `--save`。没有有效档案时才自动取 Git/SVN/系统候选，由真实人首次确认或补充一次；邮箱可选。默认项目保存，全局保存需授权，可跨工程复用。**身份登记不等于当前方案批准。** 详见 [批准与归档](references/output-conventions.md)。

用 `workflow.cjs plan` 固化最终版本；用户明确批准该方案后录入真实消息或宿主计划批准证据，再运行 `workflow.cjs check`。修订产生新版本，需要新批准。**普通工具/agent 通知、测试 fixture、沉默或 AI 自己写的“同意”不是批准。** 宿主结果必须保留实际渠道和已展示范围，见 [批准与归档](references/output-conventions.md)。

**完成条件**：当前版本已有可追查的真实批准，包含人、时间、项目、方案摘要/哈希；门禁检查成功。尚未批准时仅交付方案。

## 4. 实施与验证

按批准文件范围实现最小闭环，复用可靠的实际工程能力，不重建平台基类、登录或请求层。接口未就绪时，显式区分 mock 演练与真实成功；业务安全/事务问题记账，不照抄缺陷。

验证分层进行：

1. 核对所有字段、按钮、路径、导入、响应、必填/失败/取消/刷新；不是只查语法。
2. 用目标项目已有工具做语法/模板、lint、构建/单测。先查看命令，避免构建副作用或测试连生产。
3. Vue 2 FB 守卫：
   ```sh
   node "<skill-root>/../use-fbjs-vue2/scripts/check-fbjs-usage.cjs" --root "<目标工程>"
   ```
   如实保留退出码；窄守卫不是全部合规证明，现有项目命中要分类，不用大批豁免掩盖问题。
4. 可运行时验证浏览器/终端交互、接口与权限。缺依赖或平台时写明未验证，不把静态编译称为端到端。

**完成条件**：批准清单逐项完成或如实列待办；检查有新鲜证据，失败先定位再重跑，不能跳过后宣布全部完成。

## 5. 留痕交付

提案、批准、执行、验证、失败/跳过都实时追加审计；收尾生成可读实现档案、功能级 CHANGELOG 与提交建议。已有档案追加新的修订/事件，不覆盖旧记录。

交付说明 **改了什么、验证了什么、还有什么没做**，附文件/接口/证据路径。真实批准不能补造，测试身份不能冒充作者；未经用户要求不提交、推送或发布。

**完成条件**：实现档案可回查当前方案与批准，文件/API/待办/验证齐全，CHANGELOG 只写实际改动。
