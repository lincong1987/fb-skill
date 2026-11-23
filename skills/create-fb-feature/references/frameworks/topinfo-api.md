# TopInfo 接口口径（写 Java 接口前读）

**何时读**：目标工程依赖 `topinfo-platform`（`detect-project.cjs` 报出 `java-topinfo-2x-candidate` / `3x-candidate`），本次要写 Controller、Service、VO/Query 或接口设计。**开发规范照本文，实现细节照目标工程实际 jar/源码**；现行 2.2.x 工程与 v3.1.0 的技术线差异见 [版本差异](topinfo-versions.md)。

来源：`ai-playbook/frameworks/topinfo-api-conventions-v3.1.0.md` 与 `topinfo-platform-admin-v3.1.0.md`（v3.1.0，正在开发的新后端的正式规范）；权威源在框架仓库。

## 响应与分页

- 所有接口返回 `com.topinfo.basic.platform.common.bean.JsonResponse`（`code` / `message` / `data`；2.2.x 另有 `expand`）。成功 `JsonResponse.buildSuccess(data)`，**不得自造响应包装类**。成功码由类决定（2.2.0 jar 实测 **1**，失败 -1），文档不要硬写 200。
- 只表示"是否成功"的写接口：`JsonResponse<Boolean>`，`data` 直接为布尔值，不包 `{success:true}`。
- 分页统一 MyBatis-Plus `IPage`（`BaseMapper.selectPage`），`JsonResponse.buildSuccess(page)`；序列化为 **`records` / `total`**，不写 `list`，不自造 `PageResult`。请求参数 `current` / `size`。
- 原因：`PassKeyUtil.buildPassKey` 只识别 MP `Page` / 单 VO / `List`，自造包装会让 passKey **静默失效**。
- 时间用 `com.topinfo.basic.platform.common.util.CommonDateUtil`（`yyyyMMddHHmmss`），不自造 `DateTimeFormatter`。2.2.x 多工程在用，已核实。

## 鉴权三元组（逐接口给出，不得凭角色名推断）

```
功能权限（perms）：sys:unit:list          # 取 tp_menu.MENU_CODE
数据范围（scope）：超管:全部 / 单位管理员:本单位   # 标签见下
横向（businessKey）：— / 生成(字段) / 校验(字段)
```

- **功能权限**：`@Authorization(perms = "<MENU_CODE>")`，类级对该类所有方法生效；多权限默认 OR，`logical = Logical.AND` 需全有。免鉴权 `@IgnoreAuthorization`。**禁止用角色名/角色 ID 判权**。（2.2.x 先 `javap` 确认注解有 `perms` 属性；没有就用目标现有鉴权方式，规范不变）
- **数据范围标签**：`全部` / `本租户` / `本单位` / `本部门` / `本单位及下级` / `仅下级只读` / `本人` / `—`。列表/树按范围**过滤结果**；详情/单条越界报 `20008`。（2.2.x jar 无 `DataScopeHelper`，用 `CommonDataPermissionsUtil` 或手写范围条件，**过滤本身必须做**）
- **横向鉴权 passKey**（能力票据）：
  - 标 `生成` 的列表/详情：`JsonResponse.buildSuccess(data).buildPassKey(personId, "业务主键字段")`——**实例方法，必须链式接在 `buildSuccess` 后**，写成 `JsonResponse.buildPassKey(...)` 编译不过。VO 须显式含 `passKey` 字段，漏了静默失效。
  - 标 `校验` 的写接口：`@Authorization(perms = "...", businessKey = "字段")`，`perms` 与 `businessKey` 写同一注解。
  - **必须成对**：只校验不生成 → 前端拿不到票 → 恒 `-45`。授予写接口 `perms` 时必须同时授予其生成端读接口的 `perms`。一个 VO 只承载一个 `passKey`。
  - fail-closed：取值缺失、票不匹配、请求类型不支持（multipart/xml）、body 为空 → `-45`，不放行。
  - 回传位置：`GET`/`DELETE` 放 query；`PUT`/`POST`(JSON) 放 body 顶层。
  - 只校验**记录归属**，不覆盖树/层级/租户范围。
- **入参 id 不是身份依据**：身份只从 `tp_token` 解析；查询 DTO **不放** `tenantId` / `deptId` / `ascnId`（`ascnId` 作业务筛选如"按单位查部门"可保留，但不用于鉴权）。

## 三类场景的落地

| 场景 | 归属判定 |
|---|---|
| 列表/树（查） | SQL 带范围条件（`TENANT_ID` + 范围），不只按主键查；越界静默过滤 |
| 写（改/删）有单一主键 | 横向 `passKey` 兜底；服务层只做存在性 + 关联校验，**不列 `20008`** |
| 写 无单一主键（如授权关系） | 服务层做存在性 + 范围校验，**列 `20008`** |
| 新增 | 入参引用的关联节点（如上级 `deptPid`）须做存在性 + 范围校验 |
| 详情直访（无 passKey） | 业务代码自行判范围，报 `20008` |

## 错误码

- 框架段负数，业务禁用：`-1` 通用失败、`-44` token 失效、`-45` 横向越权、`-90~-99` 登录认证域、`-100` 系统错误。（2.2.x 无证据，用前 `javap` 查目标 jar 的 `common.bean.ErrorCode`——注意 2.2.x 在 `bean` 包不是 `enums`）
- 业务段正数：**2 位模块号 + 3 位尾号**（如 `20xxx`）。尾号全局唯一语义：`001` 参数非法 / `002` 不存在 / `003` 无功能权限 / `004` 状态不允许 / `005` 唯一冲突 / `006` 有关联不可删 / `007` 校验失败 / `008`→`20008` 越权 / `009` 配置未开 / `010` 关联对象不存在 / `011+` 自定义。
- **一码一义**：新增前全局搜索是否已占用。业务码放各模块自己的枚举，不塞进 `common` 的 `ErrorCode`。
- 功能权限失败 `xx003` 与数据越权 `20008` 同时命中时，`xx003` 优先。

## 接口卡/方案里必填的列

每个接口写清：方法、路径、`perms` / `scope` / `businessKey` 三列（真不需要写 `—`）、入参出参、分页出参 `records/total`、错误码。标 `校验` 前确认生成端已标 `生成`。

## 路径约定（Playbook 规范；2.2.x 工程照目标现有 Controller 的路径前缀写，新接口遵循 `/list` `/tree` `/{id}` 后缀）

`/platform/security/**` 登录会话（免认证）｜`/admin/**` 后台业务｜`/app/**` App 端｜`/api/**` 对外开放。列表 `/list`、树 `/tree`、详情 `/{id}`。**不要在业务模块里再写登录接口。**
