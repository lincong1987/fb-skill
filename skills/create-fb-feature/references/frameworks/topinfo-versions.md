# TopInfo 版本差异：哪些规则适用当前工程

**何时读**：`detect-project.cjs` 报出 `platform.version` / `parentVersion`，或读 [接口口径](topinfo-api.md)、[表约定](topinfo-db.md) 时不确定某条规则是否适用。

**两个技术线，一套开发规范。** Playbook 的四份框架规范是**正在开发的新后端（v3.1.0）的正式规范**，也是未来主线。现行 2.2.x 工程技术栈不同（Java 8 / Boot 2），但**开发规范是相通的**：鉴权三元组、passKey 成对、错误码一码一义、分页出参、表约定——这些是团队规范，两代都该遵守。

**铁律**：目标工程实际 jar / 源码 > Playbook 规范 > 模型通用经验。探测到的依赖版本与 parent 版本可能不一致（本机某工程依赖 2.2.1、parent 2.2.1-fix），以**实际解析到的 jar** 为准。

## 两代对照

| 口径 | 2.2.x 现行工程（本机已核实） | v3.1.0 新后端（Playbook 规范） | 2.2.x 工程怎么做 |
|---|---|---|---|
| `JsonResponse` `code/message/data`，`buildSuccess` | ✅ jar 实测，成功码 **1**，另有 `expand` | 同 | 直接用 |
| `buildPassKey` 实例链式方法 | ✅ 2.2.0/2.2.1 jar 含 `common/util/PassKeyUtil`；多工程 `buildSuccess(...).buildPassKey(jwtpid, KEY)` | 同 | 直接用 |
| `@Authorization(businessKey=...)` / `@IgnoreAuthorization` | ✅ `core/core/annotation/`，类级与方法级均有用例 | 同 | 直接用 |
| `@Authorization(perms=..., logical=...)` | ⚠️ 2.x 源码未见用法，注解属性待 `javap` 确认 | 规范要求 | **先 `javap` 查目标 jar 的注解有没有 `perms` 属性**；有就按规范用，没有就用目标现有鉴权方式并记待办 |
| `CommonDateUtil.now()` | ✅ 存在，多工程在用 | 同 | 直接用 |
| `SessionHolder` / `SessionVO` | ✅ 存在；`deptLevelcode` 未见调用 | 同 | 用前确认字段 |
| 分页 `IPage` → `records/total`，请求 `current/size` | ✅ 两工程实测 | 规范要求 | 直接用，不自造分页类 |
| `ACTIVED` 逻辑删除、`varchar(14)` 字符日期、无自增主键、雪花 | ✅ 两工程实测 | 同 | 直接用 |
| MyBatis-Plus + 原生 XML 混用 | ✅ mew-manage 57 个 XML 仅 1 个 `BaseMapper`；SOL07 `BaseMapper` 42 处 | — | 跟随目标模块风格，不强行统一 |
| `BaseEntity` / `BaseController` | ❌ 都不存在，实体是普通 POJO | 未要求 | 不造同名基类 |
| `ErrorCode` 类位置 | ❌ 在 **`common.bean.ErrorCode`** | `common.enums.ErrorCode` | **import 路径按目标 jar**（2.2.x 是 `bean`） |
| 错误码负数段 `-44/-45/-91/-92/-99/-100` | ⚠️ 本机无证据 | 规范定义 | `javap` 查目标 jar 的 `ErrorCode` 常量；对得上就用，对不上用目标现有码并记差异 |
| `DataScopeHelper.dataScopeFilter / assertInScope` | ❌ 2.x jar 无此类；最接近的是 admin 的 `TpDataPermissionsService` / `CommonDataPermissionsUtil` | 规范要求 | 2.2.x 用目标现有工具或手写范围条件，**数据范围这个规范本身仍要落实**，只是实现手段不同 |
| `PaginationInnerInterceptor.maxLimit=3000` | ⚠️ 业务工程自配（`MewManageAutoConfiguration.java:54-57`） | 框架默认 | 查目标工程配置；没有就按规范补 |
| `BlockAttackInnerInterceptor` | ⚠️ 本机未见引用 | 框架默认 | **不假设已启用**；无 `WHERE` 的写操作自己加防护，并建议项目开启 |
| `/platform/security/**` 路径、`tempToken` 选部门 | ⚠️ 未核实；2.2.x 工程**裸用 `jwtpid` 参数** | 规范要求 | 照目标现有 Controller 写；**裸 `jwtpid` 是已知问题代码**（`docs/legacy-issues.md` SEC-006），新代码不从 token 取身份不写成规范 |
| 租户层级编码 `DEPT_LEVELCODE`、权限编码总表 | admin 业务专属 | admin 业务专属 | 业务模块不涉及，跳过 |
| 运行时 | Boot 2.2.13（2.2.0）/ 2.7.18（2.2.1），**Java 8**，`javax.servlet` | Boot 3.5.16 / Java 21 / `jakarta` | 注解包路径按目标实际 |

## 现行 2.2.x 工程：实际代码 + Playbook 一起用

1. **规范层照 Playbook**：鉴权三列必填、passKey 成对、写接口不列 `20008`、查询 DTO 不放身份字段、错误码一码一义、分页 `records/total`、逻辑删除用 `ACTIVED`——这些是开发规范，**新写的代码必须遵守**，哪怕周围老代码没遵守。
2. **实现层照实际代码**：上表"✅"行直接用；"⚠️"行先 `javap` 查目标 jar，有就按规范用，没有就用目标现有手段实现同一规范。
3. **老代码的问题不照抄**：裸 `jwtpid`、手写审计字段、无数据范围过滤——这些是 `legacy-issues.md` 记录的已知问题，新代码按规范写，老代码不顺手改、记账。
4. 在方案 `todos` 里记下"2.2.x 用 XX 替代了 v3.1.0 的 YY"，方便以后升级到新后端时对照。

## 新后端 v3.1.0 工程

直接按 Playbook 规范写，本表"v3.1.0"列就是标准。本机暂无 3.x 实物（仅 `dependencies` 3.0.0-SNAPSHOT 的 `.lastUpdated` 残留），首次遇到 3.x 工程时先 `javap` 核对 jar 与规范是否一致，有差异反馈后端团队。

## 证据来源（维护者记录）

- 2.2.0 jar：`~/.m2/.../topinfo-platform-common/2.2.0-SNAPSHOT/*.jar`，`javap -c -p` 复核（见 `docs/evidence.md`）
- 业务工程：`T20240246-GMRHCP/.../trunk/mew-manage`（parent 2.2.3-SNAPSHOT）、`SOL07_FMKS_docus/.../mine-basic-gov`（parent 2.2.1-fix-SNAPSHOT）
- 平台 Java 源码本地**不存在**，`D:/projects/topinfo` 只有前端包；2.2.3 精确 jar 本地缺失（parent 最高 2.2.2、admin 2.2.0）
