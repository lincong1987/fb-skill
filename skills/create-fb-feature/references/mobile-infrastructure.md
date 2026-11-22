# 移动基础能力

**何时读**：移动请求、Store、权限、字典、上传、主题或跨端能力有变化。样本事实不能自动成为所有 uni-app 的禁令。

## 请求与 service

TA 主样本从 `@topinfoapp/ta-js/lib/ajax.js` 注入 `$ajax`，本地 service-util 扫描 service 目录并给服务注入 `$host/$ajax`。保留 this 绑定，不把实例方法解构成丢失上下文的函数。

```js
// 形状示例：具体 URL、upload 参数和方法仍需核对目标。
save(data) {
  return this.$ajax.post({ url: this.$host + '<已确认路径>', data })
}
```

不能因为 package.json 有 flyio/uni-simple-router 就认为业务用了它。读 main、service-util、router 与实际调用判断；目标原生 uni.uploadFile 合法可用时检查其认证/失败/清理，不一刀切禁止。

global-blending 的 commonResultView/Save/Delete 与 callPreDataFun 是项目 helper；先确认定义、输入信封、回调和错误提示。无法核实 ta-js 拦截器时不宣称 token/loading/错误都会由库正确处理。

## Store、导航与权限

service/store 目录 camelCase 映射只在目标 loader 这样做时成立；persistedstate paths 对应实际注册名。身份/权限敏感值不随意写入调试日志或持久化大对象。

按钮权限 helper 和登录菜单数据形状要核对（字符串/数组等）；真正授权在后端。导航参数编码，详情可直达；过期登录/空 ID/网络失败有处理。

## 附件与跨端配置

复用目标上传包装与文件服务，明确 value 模型、引用类型/业务 ID、token 注入、失败/撤销/清理；不抄样例 referType 为真实业务码。

`window`、`document`、localStorage、H5 注入的 configObj 在 App/小程序未必存在；按平台条件/可靠配置注入封装。运行时前端配置仍公开，不能存私钥。

## 样式与资源

按目标 rpx/px 约定与 ta-theme/本地主题变量；属性里的间距数组可能被包装转换，读源码再定。H5 html 主题切换不自动适用于 native。

定时器、事件、图表/播放器有生命周期拥有者；注册/销毁配对，后台行为按需求。新增大资源/原生权限/分包属于具体工程决策，不因为样本有就复制。
