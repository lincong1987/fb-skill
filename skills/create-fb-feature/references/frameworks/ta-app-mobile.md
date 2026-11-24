# TA 移动端团队规范（ta-app-frame 写法）

**何时读**：探测结果为 `mobile-ta-uni`。先看探测里的 `taApp`：`teamRules` 不为空就**先读项目自己的** `.agents/rules/project_rules.md`，它比本文优先；`referenceModules` 列出的现成模块是首选照抄对象（已按内容排除空壳页和引用不存在 `$service` 的模块，排除的列在 `skippedReferenceModules` 并附原因）；`componentRegistration` 决定哪些 `ta-*` 标签能直接写；`uiLine` 决定下面哪些组件属性可用。通用原则见 [移动页面](../mobile-page-templates.md)、[移动基础能力](../mobile-infrastructure.md)。

来源：移动端团队 `@topinfoapp/ta-app-trae@0.0.9`（2026-11-10，含 `project_rules.md` 与生成业务模块/首页两个 skill）。组件属性按 `@topinfoapp/ta-ui@0.1.208` 源码核实，并与 `1.0.37` 逐个比对。本文是**团队写法**，不是所有 uni-app 的禁令；项目现有写法不同就跟项目。

## 先认版本线（ta-ui 两条线并行）

| 线 | 状态 | 说明 |
|---|---|---|
| `0.1.x` | 持续发布（0.1.208 发布于 2026-11-10），registry `latest` 指向它 | 团队模板按这条线写 |
| `1.x` | 停在 1.0.37（2025-10-14） | 组件注册表与 0.1.208 相同，但部分属性被删，见文末差异表 |

Vue 2 遇到不认识的属性**不报错、直接忽略**，所以版本线弄错不会编译失败，只会功能悄悄失效。`uiLine` 为 `unknown` 时先查清再写属性。

## 目录与命名

| 项 | 团队写法 |
|---|---|
| 接口 | `src/service/{模块}/index.js`，经 require.context 注册为 `this.$service.{模块}`；页面里不散落 ajax |
| 页面 | `src/pages/{模块}/{模块}-list/add/update/edit/view/tab.vue`；tab 子界面 `sub/sub-xxx.vue` |
| Store | `src/store/{模块}/index.js`，`namespaced: true` |
| 方法名 | service `apiXxx` 或 `queryList/add/update/view`；事件 `xxxClick`；布尔 `xxxBoo`；computed `coXxx`；mutation `setXxx`；action `saveXxx` |
| 组件 | `cu-` 前缀为项目业务组件；props 写 `type` + `default` + 行内中文注释 |
| 注释 | 文件头与方法 JSDoc：description / author / time / param / return。`@author` 用本 Skill 已登记的显示名，**不再每次询问** |
| 样式 | SCSS + scoped、rpx、`@include flexMi(row/column)`、颜色用主题变量 `var(--brand-color)` / `var(--xx_N)` |

`cu-page-frame`、`ta-list` 是**项目本地组件**（探测 `localComponents`），不在 ta-ui 包里；用之前读项目里的实现确认 props 与插槽（`#content/#title/#footer/#ext`）。

## 组件注册范围（先看再写标签）

`main.js` 引的 ta-ui 入口决定哪些组件全局可用。`lite.js` 只注册约 17 个（button/input/form/form-item/textarea/view/picker/picker-custom/title/text/search-bar/card/tag/icon/list-group/list-item/empty-view）和 `$toast`/`$dialog`；`ta-date-picker`、`ta-button-custom`、`ta-filter`、`ta-image-uploader`、`ta-file-uploader`、`ta-grid` 等**不在其中**。未注册的标签不报错、不渲染。

- 看探测 `componentRegistration`：`registered` 之外的组件，在页面里 `import` 后写进 `components`，路径用 `unregisteredTags[].importPath` 或包内实际文件（写法同项目 `login.vue`）。
- `unregisteredTags` 列出的是**现有页面里已经没注册的标签**，这些页面不能证明标签可用，不要照抄标签本身。
- `source` 为 `project-copy-unverified` 时清单来自项目内 `src/ta-ui/` 副本（依赖未安装），与锁定版本核对后再用。
- `pages.json` 配了 `easycom.custom` 的项目，命中规则的标签视为已注册；`src/components/<名>/<名>.vue` 由 uni-app 默认 easycom 自动注册。

## 页面闭环（团队模板的链路）

- **列表**：`cu-page-frame` → `ta-search-bar` + 可选 `ta-filter` → `ta-list :url :param :txHeight @itemOnClick`（`ta-list` 自己请求，url 为相对路径不带 host）。卡片头部 `ta-icon` + 时间 + `ta-tag` 状态，颜色/文案抽 computed（`coStatusColor` 等），模板不写嵌套三元。
- **新增**：`ta-form :model ref` + `ta-form-item lableName prop required :rules`（组件库拼写就是 `lableName`）。提交链路：`validate().then(res => res.valid)` → `service.add` → `commonResultSave(result, 成功回调)` → `$WebLogger.send({ moduleCode, operateType, operterRid })` → 通知列表刷新 → `uni.navigateBack()`。
- **详情**：`onLoad(opt)` 取 `opt.id` → `service.view({ id })` → `ta-view title :value`（日期 `type="date"`，长文本 `type="textArea"`）。
- **注册**：`pages.json` 按 list → add → update → view 追加，`navigationStyle: "custom"`；分包项目路径带分包根。
- **新增入口**：列表右下角 `ta-button-custom type="circle"` + `jpx-icon-add-normal` + `addClick`。

`commonResultView/Save/Delete` 约定：`code == 1` 成功、`code == -1` 自动 toast `message`、其余走网络失败回调。它们与 `callPreDataFun`/`preDataFun` 来自 ta-js 全局 mixin，项目没装依赖时按项目调用点核对。

### 照抄时注意（团队模板自身的缺口）

1. **双重刷新**：模板既在 `onShow` 里 `refresh()`，又在保存后 `callPreDataFun('refresh')`，返回列表会请求两次。二选一：保留 `onShow` 刷新就不调 `callPreDataFun`；或者列表只靠 `preDataFun` 刷新、`onShow` 只在首次进入时加载。
2. **修改页只从 Store 回显**：`system/getObj` 在直接打开/刷新页面时为空。按详情页的做法用 `opt.id` 调接口取数据，Store 只当加速。
3. **重复提交**：模板的 `saveClick` 没有防重；提交期间置 `submitBoo` 并在回调里复位。
4. 模板里 `TODO_` 占位（接口地址、埋点 code、`referType`）必须在交付说明里列为待办，不能当作已完成。

## 字段 → 控件对照（生成表单时按字段名 + 中文名判断）

优先级：用户明确指定 > 项目现有写法 > 本表。

| 字段语义 | 控件（0.1.208 已核实） |
|---|---|
| 类别/类型/状态/层级等枚举，远程字典 | `ta-picker-custom :url="$config.paramUrl" :param="{comPid:'字典code'}"`，0.1 线另可 `:customResultMapp="{label:'text'}"` |
| 枚举在本地常量 | `ta-picker-custom :propListData="xxxArr"`（data 里 `cloneDeep(this.$constants.xxx)`） |
| 枚举需级联/回显名称 | `ta-picker-param-custom :customParam :valueName.sync` |
| 行政区划/所属区域 | `ta-picker-area-custom useType="code" :valueName.sync` |
| `*Time`/`*Date`，或含时间/日期/期限 | `ta-date-picker formatter="yyyy-MM-dd"`（需时分秒时改格式） |
| 描述/情况/备注/地址/范围 | `ta-textarea`（`showBottomBorder`/`autoHeight` 按需） |
| 数量/人数/面积 | `ta-input type="number" :maxlength` + `:rules` 正则，正则常量以 `xxxEx` 命名放 data |
| 照片/图片 | `ta-image-uploader :num referType v-model :value`，四个地址用 `$config.systemImageUploadUrl/DownUrl/QueryUrl/DeleteUrl`；初值 `{}` |
| 证照/图纸/文件/附件 | `ta-file-uploader :referId :referType maxNum accept` + 同上地址；0.1 线另有 `fileSize` + `@fileExceedLimit` |
| 是否xxx（业务录入） | `ta-radio-group v-model` + `ta-radio lable="1"/"0"`（拼写就是 `lable`），同组 `name` 一致 |
| 多选标签 | `ta-bg-radio type="multiple" :radioData` |
| 经纬度/定位 | 不手填：`ta-form-item lableExtIcon="jpx-icon-location-fill" @lableExtClick` 调项目地图选点回填 |
| 状态流转字段（系统赋值） | 不进表单 |
| `xxxName` + `xxxId` 人员类 | 只生成 Name 选择项，Id 由选择联动或后端赋值 |
| 系统带出不可改 | 控件加 `disabled`，规则保留 |

必填：缺了记录就无效的核心字段（人、地点、时间）设 `required` + `:rules`；辅助信息不强制。字典 code、必填范围推断不出时，在方案里问用户或标 `TODO_`。联动显隐用 `<template v-if="formData.x=='值'">` 包一组 `ta-form-item`。

## 列表高度 `txHeight`

`ta-list` 可视高度 = `windowHeight - txHeight`，`txHeight` 是“列表顶部到屏幕顶 + 列表底部到屏幕底”的总距离（px），不是列表自身高度。按设计稿量 `topY`、`bottomGap`：

`txHeight = Math.round((topY + bottomGap) * (windowWidth / designWidth))`（750 稿即 `/ 750`）。

不凭经验写死 150/170/310；在 data 里用行内注释写明 `topY`、`bottomGap` 的取值。没有设计稿时标为待确认。

## 图标与上传

- 图标只用 iconfont `jpx-icon-*`（多数有 `-fill` 版），**不编造类名**。拿不准时从项目引入的 iconfont CSS 或团队规则给的线上 CSS 里提取类名，把候选列给用户。
- 图片只用 `ta-image-uploader`，附件只用 `ta-file-uploader`，不用 `uni.chooseImage` 手写九宫格；详情页用 `disabled` + `readOnlyView` + `referId` 只读展示。新增页与详情页的 `referType` 保持一致。
- 原型来自内网地址（`http://10.10.0.*`）时，原型只定结构、字段与交互，视觉用 ta-ui 组件实现，不照着原型手写样式。

## 首页（按设计图生成时）

设计图从上到下拆区域，每个区域一个 `sub/sub-index-xxx.vue`（用户区、常用功能行、宫格 `ta-card + ta-grid + ta-grid-item`、统计区、公告）。菜单权限 mixin 与菜单 JSON（`src/static/data/index-menu.json`，分组 → `child: [{text, code, icon, bgColor, url, badgeAttr}]`）**复用项目现有实现，不重写**。拆区域结果先给用户确认。

## 1.0.37 与 0.1.208 的差异（团队模板会用到的部分）

| 组件 | 1.0.37 中不存在 |
|---|---|
| `ta-picker-custom` | `customResultMapp`、`valueName`、`slice`；事件 `update:valueName`、`pickerDelete` |
| `ta-picker-param-custom` | `customResultMapp`、`fixedParam`、`showNameSign`、`lastSelectNum` |
| `ta-picker-area-custom` | `customParam`、`customResultMapp`、`fixedParam`、`disabled` 等 |
| `ta-file-uploader` | `fileSize`、`textTips`；事件 `fileExceedLimit`、`fileClick` |
| `ta-image-uploader` | `lgnoreDelIds`（1.0.37 新增 `isEightP`、事件 `delete`） |
| `ta-date-picker` / `ta-picker` | `showClear` |
| `ta-form-item` | `lableNameFontSize`、`lableNameColor`（新增 `padding`、`margin`） |
| `ta-textarea` | `showBorder`、`padding`、`margin`、`fontSize` 等样式属性 |

1.x 项目：上表属性不要写；需要同等功能时照抄项目现有页面，找不到就在方案里标出、交给用户决定。未列出的组件属性仍以目标项目安装的源码为准。
