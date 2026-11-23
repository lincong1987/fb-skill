# TopInfo 表约定（设计表或写 DDL 前读）

**何时读**：目标工程依赖 `topinfo-platform`，本次新建表、加字段、写 DDL 或 Entity。**表约定是团队开发规范，两代都遵守**；实现细节先读目标工程现有 DDL/升级脚本。通用设计原则见 [数据库](../database.md)，本文只写 TopInfo 的**取值**；2.2.x 差异见 [版本差异](topinfo-versions.md)。

来源：`ai-playbook/frameworks/topinfo-db-conventions-v3.1.0.md`（v3.1.0，正在开发的新后端的正式规范）；权威源在框架仓库。

## 命名

| 项 | 取值 |
|---|---|
| 框架表前缀 | `tp_`——**仅框架自带表**（组织、权限、工作流等），业务表**不套用** |
| 业务表前缀 | 不预设；表设计时 AI 按业务域推荐、人工确认，确认后项目内保持一致 |
| 表名 | 全小写下划线，模块前缀分段，如 `tp_dept_basicinfo` |
| 索引 | `IDX_` 普通 / `UK_` 唯一 |
| 工作流 | `wfre_` 定义层 / `wfru_` 运行层 / `wfhi_` 历史层 |

## 通用字段（框架固定名与类型，几乎所有业务表都带）

| 字段 | 类型 | 含义 |
|---|---|---|
| `ACTIVED` | int / tinyint | **逻辑删除**：1 有效，0 无效。所有查询带 `ACTIVED = 1` |
| `ENABLED` | int / tinyint | 启停：1 启用，0 停用 |
| `CREATE_TIME` | varchar(14) | `yyyyMMddHHmmss` |
| `CREATOR` | varchar(36/50) | 创建人 ID |
| `UPDATE_TIME` | varchar(14) | 同上格式 |
| `UPDATOR` | varchar(36/50) | 修改人 ID（注意拼写是 `UPDATOR`） |
| `TENANT_ID` | varchar(36/19) | 租户隔离 |
| `ASCN_ID` | varchar(36/19) | 所属单位 ID |
| `EXTEND01`~`EXTEND05` | varchar(150/255) | 扩展备用 |
| `ORDER_INDEX` | double(10,2) | 排序号 |
| `LEAF` | int | 是否叶子节点 0/1 |

按目标表的实际需要取用；不是每张表都必须全带（2.2.x 工程里实体多为普通 POJO，手工重复 `creator/createTime/updator/updateTime`）。

## 主键与 ID

- 主键 `varchar(36)`（UUID/SM3 摘要）或 `varchar(19)`（雪花 ID），**无自增主键**。
- 2.2.x 实测：`SnowflakeIdUtil.nextIdStr()` 生成雪花串；`@TableId` 未指定时 MP 默认 `ASSIGN_ID`；DDL 主键 `varchar(36)` / `varchar(50)` / `char(32)`，`AUTO_INCREMENT` 零出现。

## 关键取值

1. **逻辑删除用 `ACTIVED`，禁止物理 `DELETE`**。确需物理删除的表，在项目 ER 文档登记表名与理由。2.2.x 两种写法并存：`@TableLogic(value="1", delval="0")` 或手写 `UPDATE ... SET ACTIVED=0`——跟随目标模块现有写法。
2. **时间用字符串** `varchar(14)`：可按字符串排序比较，**不能直接用数据库日期函数**。
3. 多租户：核心业务表带 `TENANT_ID`；工作流表额外 `ASCN_ID` 做单位级隔离。
4. 字符集 `utf8mb4` / `utf8mb4_bin`，引擎 `InnoDB`。例外（如验证码临时表用 MEMORY）须在 ER 文档登记。

## 框架级配置（Playbook 规范为框架默认；2.2.x 实测分页上限是业务工程自配，查目标工程自己的配置）

| 项 | 取值 |
|---|---|
| 隔离索引 | 核心表建 `IDX(TENANT_ID)` |
| 分页上限 | MyBatis-Plus `PaginationInnerInterceptor.maxLimit = 3000`（2.2.x 见 `MewManageAutoConfiguration.java:54-57`） |
| 全表操作防护 | `BlockAttackInnerInterceptor` 拦截无 `WHERE` 的 `UPDATE`/`DELETE`（**2.2.x 本机未见引用**：无 `WHERE` 的写操作自己加防护，并建议项目开启） |

2.2.x 实测：mew-manage 分页方言硬编码 `DbType.MYSQL`，**无达梦 Java 分支**；SOL07 有独立达梦 DDL。写达梦相关 SQL 时先查目标模块有没有方言适配，不要假设框架已处理。
