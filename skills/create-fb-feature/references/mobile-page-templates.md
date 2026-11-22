# 移动页面：先认 uni/TA/TX 谱系

**何时读**：目标为 uni-app 移动页面。检测 pages.json/manifest.json 与实际插件/easycom，不把任何移动项目都套成 TA-UI。

## 可得证据

主参考 `mew-manage-app-ui` 声明 TA-UI、ta-js 和 Vue 2.7，页面使用 `cu-page-frame`、ta-*；旧 `xzhapp-gov-zjindustry` 是 TX/ColorUI 与本地请求体系。后者未被本任务宣布废弃；修改旧目标就先核对其真实体系。

TA 主样本未安装依赖：包级 props/events 只有调用点证据，不能当完整 API。项目本地 `ta-list` 等有源码可核实。要新增未证实 TA 组件时取得依赖/源码，或先交付明确未验证的骨架；不把“样本未用过”写成“库中不存在”。

## 页面闭环

1. 在目标 pages.json 主包/分包注册真实路径，导航写法与当前启用的 router/uni API 一致。
2. 列表、详情、表单分别明确稳定主键。进入详情用编码后的 ID，详情从授权接口读取；仅靠全局 Store 整对象会缺直达/刷新能力。
3. 保留已有页面壳、间距与主题。ta-* 和 cu-* 的拥有者不同，先看 easycom 与本地实现。
4. 列表查询、筛选、清空、分页、下拉/上拉、空态/网络失败要闭环。`ta-list` 的 url/host、txHeight 单位和 initList 行为只适用于已读本地实现。
5. 保存验证成功后才请求；请求成功后通知列表并返回，取消不伪报成功。刷新采用目标已正确启用的一条机制，不重复事件 + callPreDataFun 导致两次请求。

## 表单与返回

已观察主样本的 `ta-form-item` 属性拼作 `lableName`、规则为 `:rules`，校验 `validate().then(result => result.valid)`；这是调用点线索，生成前须尽可能核对目标源码。

PC 的 `rule`/回调语义不搬到 TA。日期/附件值结构也不能借 PC 组件 API。缺 TA 源码时，输出中注明哪些标签/属性未验证，不假装通过 native 构建。

服务与结果 helper 应使用一致变量，不留 `result`/`res` 错配。新增/编辑接口分清，id 缺失或加载失败有退出/重试，不让表单悄悄进入错误模式。

## 生命周期验收

页面 onUnload 清理事件、定时器、请求/原生资源，组件按 Vue/uni 生命周期清理；onHide 是否暂停轮询按后台行为需求。

验证范围写清 H5、App/小程序、真机哪些已做。H5 模板编译不能证明原生能力可用；没有安装 TA 依赖就明示构建未验证。
