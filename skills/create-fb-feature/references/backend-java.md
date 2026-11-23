# Java 后端：目标框架取证后生成

**何时读**：本次要写 Java 接口、业务、持久层或测试。优先复用目标模块，不依据旧规则新建“统一平台”。

## 先核对一条完整业务链

选择目标相邻的正确同类功能，读取 effective parent POM/Java/Spring/MyBatis-Plus 版本与：

| 层 | 要核对 |
|---|---|
| Controller | URL/HTTP 方法、query/body/multipart、校验、真实响应类、认证/授权 |
| 请求模型 | 字段/必填/可修改范围、分页、日期、主键 |
| Service | 业务校验、权限/归属、写入顺序、异常/事务、依赖注入 |
| Mapper/XML | 参数名、resultMap/别名、分页插件、动态 SQL、方言 |
| Entity/DDL | 表/列名、类型/长度、ID 生成、审计填充、删除语义、约束 |
| 平台 | 真实 JsonResponse/Result/BaseEntity/异常/身份解析器定义与 imports |
| 测试 | JUnit/Mockito 实际版本、是否需 DB/外部服务、可隔离执行的命令 |

类位于平台依赖包时，核对依赖/JAR/可得源码，不造一个同名基类骗过编译。路径和字段闭合后再写模板。

**依赖 topinfo-platform 时**（探测报 `java-topinfo-2x-candidate` / `3x-candidate`）：先读 [接口口径](frameworks/topinfo-api.md) 和 [版本差异](frameworks/topinfo-versions.md)。**规范层照 Playbook**——鉴权三列、passKey 成对、写接口不列 `20008`、一码一义、分页 `records/total`、查询 DTO 不放身份字段，新代码必须遵守，周围老代码没遵守也不照抄。**实现层照实际 jar/源码**：版本差异表标"⚠️"的能力（2.2.x 的 `perms`、`ErrorCode` 包路径、`DataScopeHelper` 等），先 `javap` 或 IDE 查目标 jar，有就按规范用，没有就用目标现有手段实现同一规范，并在 `todos` 记"2.2.x 用 XX 替代了 v3.1.0 的 YY"。老代码里的裸 `jwtpid`、无范围过滤是已知问题（`docs/legacy-issues.md`），新代码不写成规范、老代码不顺手改。

## 生成边界

按目标层次生成最小必要文件。Controller 负责映射/验证/调用，Service 处理用例，Mapper 做持久化；DTO/Query/VO/Entity 是否拆分与命名跟随该模块，避免为一行改动生成一堆空壳。

- 不强制某个 HTTP 路径、成功码或 `JsonResponse<T>`。已有真实响应类复用；消息 overload、passKey 注入等读其定义，不能凭名称猜。
- imports、接口与实现、调用的 queryById/delete 等方法全部闭合；不得给“省略 getter/未定义 dto”示例并称可编译。
- ID 策略区分 MyBatis-Plus ASSIGN_ID（通常雪花值）与 ASSIGN_UUID；手工 UUID、数据库自增或项目工具也可能是已确认契约，不强行替换。
- 审计由真实 MetaObjectHandler/SQL/Service 谁填就遵循谁；不是所有 BaseEntity 自动填。String 日期不靠 @JsonFormat 凭空转换。

## 身份、权限与事务

认证从服务器可信上下文/已证实参数解析器取得。裸 String jwtpid 方法参数不能靠注释保证是可信注入；核对 resolver 支持范围/绑定顺序。列表数据范围、详情、更新和删除分别校验，前端 passKey/按钮隐藏不代替后端授权。

事务按目标 Spring 版本、代理与调用方式选择。常见 public Service 代理事务安全清晰，但不能宣称所有非 public 在所有版本都无效；private/自调用绕过代理、吞异常提前“成功”要避开并测试。

多表写入/引用校验有业务原子性要求时设置事务并验证回滚；不无条件给每个写方法加相同注解，也不禁止合理查询事务。缓存策略依读写一致性与现用机制选择，非全工程必须二选一。

## Mapper 与方言

多参数 `@Param` 名称与 XML test/#{ } 一致，result 映射对应 VO/实体。分页使用已启用插件或现用 SQL，不能两边都 LIMIT。排序与动态标识符服务器白名单，值使用参数绑定。

避免全量批量写/空集合误删，按业务校验引用/唯一/不存在/并发冲突。MySQL、达梦或其他方言用现有适配方法，未执行目标 DB 就标方言未验证。

## 验证和交付

优先运行可隔离的目标 module compile/unit tests，先看配置，不启动应用或连接生产。JUnit 4、5 与 Mockito 按目标依赖使用，不能把兼容旧版本直接宣布废弃。

验证至少覆盖正确写入、校验失败、越权、缺失记录、事务失败/回滚、分页/字段映射。无法编译平台依赖时明示原因；只编译 stub 不是实际业务工程通过。

新增接口同步前端契约与迁移，错误/未就绪如实列待办。旧版本依赖、安全缺陷与风格差异记录问题台账，任务不扩展成旧服务端整改。
