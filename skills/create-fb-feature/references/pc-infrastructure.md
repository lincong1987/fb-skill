# PC 基础装配

**何时读**：新增工程、改启动/全局请求/布局/主题或排查基础能力。日常页面开发不加载。

## 找到真正入口

读取现用构建配置（Vue CLI、Rsbuild 等）、project/fb config、入口 main、generator 与 Application。文件“存在”不等于参与构建；多个配置不因本 Skill 自动删除，要明确当前生效路径。

已观察的 FB Vue 2 模式是 `new Application({ projectConfig, generator, use, mixins, render }).start(callback)` 并挂 `window.app`。在源码中确认插件导出与安装时序，所需工具需真实 import；不要粘贴带未定义 setRouterBefore/mountedAppEvent/WebLogger 的“完整 main”。

`@topinfo/tp-components` 的 Page 与 fb-core 旧 FbDialog Page 不互换。project-local 包装/覆盖优先核对实际注册；是否重构它属于独立需求。

## 请求与认证

逐段确认实际 `serviceConfig`：token 来源、header 注入、passKey、响应解包、错误提示/reject、loading、文件流。包内默认与项目覆盖不同时，以目标有效实现为事实。

需要新增请求不重写登录/拦截器。修改拦截器时测试并发计数、失败/取消 finally、登录失效、下载错误；不要从别处复制作用域里的 passKey 或默认储存假设。

`$datax` 的底层 storage/前缀、tokenUtil 是否启用、刷新间隔必须查当前配置，不能宣称所有项目都是 sessionStorage。客户端配置是公开内容，不用于保密私钥/长效凭据。

## 布局、主题与系统服务

admin-base 常提供布局、菜单、tabs/store/sys services，但实际 generator 与本地覆盖决定可用命名空间。检查依赖与安装后使用，不假设任意 `$svc.sys.*` 都有。

新增业务页通常无需改布局/登录。主题、菜单权限、keep-alive、页面刷新与实际路由共同验收；目标有正确自定义包装时沿用，不为了“库纯净”删除用户代码。

只实现需求涉及的基础能力，安全/死入口/重复配置等历史问题写独立台账，不顺手扩展整改范围。
