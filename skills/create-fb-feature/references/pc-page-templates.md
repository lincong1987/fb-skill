# PC 页面：列表、表单与弹窗

**何时读**：目标是实际 Vue 2 FB 管理页面。先核对目标的 fb-ui、tp-components、Page mixin 和本地覆盖，不照抄整页旧模板。

## 目录与组件取证

常见扫描结构是 `src/views|service|router/<domain>/<entity>/`；是否需要路由、服务命名空间如何生成，以实际 generator/require.context 为准。小改只动需要的文件。

最小常见组合：

| 能力 | 查证对象 | 已观察的调用点 |
|---|---|---|
| 搜索页 | `fb-page-search` slots | query、buttons、actions、table |
| 表格 | `fb-simple-table` props/methods/reader | columns、service、param、pk；doSearch/doReload/getSelectedRows |
| 表单 | `fb-form` / `fb-form-item` | model/数据获取、`:rule` 单数、validate(callback) |
| 下拉 | `fb-select` | data/service、option slot、reader/value 类型 |
| 日期 | `tp-datepicker` 或实际 fb-datepicker | mode、format/value-format；两个组件 API 不混用 |
| 弹窗 | 实际注册的 `tp-dialog` 与 Page | show() 参数、param/parentPage/meta、关闭回调 |
| 按钮 | `fb-button` | `@on-click`，目标尺寸 s/m/l |

`columns` 列项常用 `name/label/slot/width`；具体格式与 slot 参数检查目标源码。不会因为知道 FbUI 而发明 `fb-table-column` 或 Element 风格选项组件。

## 一个列表闭环

1. 查询参数全部在 data 声明；查询/重置回到第一页。resetFields 是否真实重置 v-model 要核对 model/prop，不能只放一个按钮。
2. 表格 pk 与后端主键一致。选择模型返回的是行还是 key 由组件决定；批量操作不猜。
3. 每个需求操作都有入口、有 handler、有 service/明确待办。导出只有方法没有按钮不算完成。
4. 父子弹窗成功/取消区分；新增后按需求回第一页或刷新，编辑通常当前页刷新。删除最后一条时要处理空页。
5. 详情从稳定 ID 拉取（带权限），编辑只提交可改字段；不把整个 VO 的审计/权限/展示属性原样提交。

示例仅说明已查证的方法关系，不是可直接粘贴的完整页面：

```js
handleQuery() {
  this.$refs.table.doSearch()
},
closeDialog(result) {
  if (!result || !result.success) return
  if (result.action === 'add') this.$refs.table.doSearch()
  else if (result.action === 'edit') this.$refs.table.doReload()
}
```

子页保存成功才 `closeTpDialog({ success: true, action })`，取消不传成功标识；目标项目已有正确关闭约定时沿用。Page mixin 来自哪个包、是否安装要查；fb-core 的旧 FbDialog Page 不等于 tp-components 的 tp-dialog Page。

## 表单、失败与交互

- PC 常见 `fb-form-item :rule`，不是 TA 的 `:rules`。通过 validate 回调为 true 才提交；数据绑定和 prop 对应必测。
- 日期显示与提交分开。`tp-datepicker value-format` 已输出指定字符串时不用重复转换；fb-datepicker 不凭 Element 习惯添加 `type="daterange"`。
- 保存请求中锁住重复提交，finally 恢复状态；失败不关闭，字段错误保持可修。提示由页面还是拦截器负责，按实际行为划分。
- `$confirm` 的回调/Promise 以实现为准；已观察 FB 版本为回调，不能习惯性 await。
- `fb-tree-select` 已核实样本没有 `on-select`；可用实际 on-change/on-select-change 或 watch(model)，但参数形状也要核对。

## 证据与验收

取证入口：目标安装包的 `fb-ui/src/components/**`、`@topinfo/tp-components` 与本地 `src/components`/`src/util/Page.js`。调查样本有 fb-ui 1.1.826/1.1.840、tp-components 2.2.15/2.2.16，但不是所有版本的保证。

每次验收至少检查查询、重置、空列表、单/批量操作、必填校验、保存失败、成功/取消关闭与刷新、权限受限。解析成功不证明这些交互成立。
