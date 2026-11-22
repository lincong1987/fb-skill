# PC Service、路由与业务能力

**何时读**：涉及请求、路由、菜单、字典、附件或导入导出。先读实际 generator、serviceConfig 与对应后端，不从 HTTP 动词或 URL 习惯推断契约。

## Service

FB 常见路径扫描生成 `$svc.<domain>.<entity>`；方法保持请求层的实际返回值/Promise。框架 serviceTool 有默认 CRUD 映射，但业务是否采用由当前代码/后端决定，不要求重写所有默认方法。

```js
// 例：仅适用于已确认 GET+params 的接口。
search(params) {
  return app.service.get('/<已确认路径>/list', { params })
}
```

写接口表至少包含方法、URL、query/body、字段、响应/失败、权限。JSON、表单编码、multipart、GET/POST/DELETE 均按真实后端；不能强行改成“全是 JSON”而断开联调。

用到 defaultsDeep、Qs 等需核对其来源并显式导入，不复制隐式全局。动态 this 的服务方法保持绑定。轮询 loading 语义查看目标拦截器，有些包与项目版本含义相反。

## 路由与菜单

- 自动扫描文件是否进入 generator，aliases/懒加载路径是否存在，实际挂载容器是谁，逐项核对。
- 新列表可能需要路由；弹窗页未必需要独立路由。菜单 path 对应实际注册 path。
- 权限码从目标后端菜单/常量读取；大小写只是现有契约，不自动改为大写。需要权限时不放空串假装鉴权；前端隐藏仍不代替后端授权。

## 字典与附件

`$svc.sys.dict.select/tree` + `pdicCode` 是常见样本，不保证每项目都用同参数/reader。静态小枚举或后端已给 xxxName 都可采用已确认方式，不能凭空新建字典码。

附件优先复用目标 `tp-upload`/项目包装与真实文件服务。核对 `referType/referId`、value 模型、上传回调、读取/删除权限、未保存附件归属。不要根据一个实例发明所有上传 props。

## 导入导出

1. 确认按钮、handler、service、后端接口闭环，不把孤立方法计为完成。
2. 下载 helper 如 `app.download` 是项目注入能力，必须找到定义；不无条件假设存在。
3. blob 失败可能是 JSON/鉴权信封，先检查响应再下载；文件名、中文编码、Content-Disposition 与权限也要验。
4. 导入验证模板/大小/类型，成功失败计数由真实后端返回；结果弹窗 ref 必须实际存在，不能只写 this.$refs 调用。

## 弹窗加载契约

`tp-dialog.show` 和 `tp-dialog-tab.show` 查目标实际实现，特别是本地同名覆盖。不要用笼统“1.x 全不支持 Promise / 2.x 全支持”替代源码。字符串路径和 import() 各有适用版本，参数注入与关闭回调一并验证。
