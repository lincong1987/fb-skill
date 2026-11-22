# 真实项目基线与证据边界

取证日：2026-11-21。参考资料够支持本次重做；“够”指可继续设计/实现，不等于所有端已经编译或联调通过。业务项目只读。

## 前端实际安装（不要混副本）

| 实际根 | 已读安装版本 | 用途 |
|---|---|---|
| `D:/projects/SOL07_FMKS_docus/MINE_CODE/gov/trunk/mine-gov-ui` | Vue/模板编译器 2.6.12，fb-ui 1.1.826，fb-core 1.1.824，fb-third 1.1.810，tp-components 2.2.15，screen-base 1.0.81，Rsbuild 1.7.5/plugin-vue2 1.1.1 | 用户给定主取证/隔离运行依赖 |
| `D:/projects/T20240246-GMRHCP/T20240246-GMRHCP-Code/branches/V3.51-20261116/mew-manage-ui` | Vue/编译器 2.6.12，fb-ui 1.1.840，fb-core 1.1.824，tp-components 2.2.16，screen-base 1.0.81 | 较新 PC 对照 |
| `D:/projects/T20240246-GMRHCP/T20240246-GMRHCP-Code/trunk/app/mew-manage-app-ui` | 声明 TA-UI/ta-js；node_modules 缺失 | 本地包装/调用点可读，包级 API 与 App 构建未验证 |
| `D:/projects/ent-deepwell-ui-new_tv` | node_modules 缺失 | screensj/maintv 等入口/布局线索，不是可运行后台基线 |

曾有调查代理把 `D:/projects/mine-gov-ui`（Vue 2.7.16、fb-ui 1.1.819）写成上述 SOL07 路径的简称。**它们是两个不同 realpath/不同安装的目录。** 本次运行基线使用用户给定完整 SOL07 根，不混用版本。一个项目 package.json 的声明范围不证明其他副本运行版本。

## 几条已核实 API（路径前缀 = SOL07 主根 `/node_modules/`）

| 证据 | 结论 | 限制 |
|---|---|---|
| `fb-ui/src/index.js:87-120` | 注册真实组件，注入 $message/$confirm 等 | 仍需目标实际 Vue.use/本地覆盖 |
| `fb-ui/packages/components/form/src/FbForm.vue:34-51,146-171` | model、rule；validate callback，亦有 Promise 分支 | 不把 PC 回调迁为 TA validate.valid |
| `@topinfo/tp-components/src/index.js:13-29,52-57,75-80` | 安装包注册 7 个组件，导出 Page | 本地同名覆盖改变实际 owner |
| `@topinfo/tp-components/src/components/tp-dialog/tp-dialog.vue:18,79-152` | 接收 Promise 或字符串；该版本注入 param,parentPage | 没有注入 meta，不能照样例假设第5参数 |
| 同文件 `:155-170` | 子页关闭回传 truthy 值/取消无值，父监听 closeTpDialog | 目标本地覆盖仍须查 |
| `@topinfo/tp-components/src/util/Page.js:80-117` | 旧格式化逻辑含 `!date instanceof Date` 优先级问题 | 不把该错误方法抄成新规范 |
| `@topinfo/screen-base/src/components/index.js` | 实际注册表确认 screen-* | 未注册的想象标签不得生成 |

源码工具曾漏掉本地 kebab-case `name: 'tp-dialog'`；已纳入修复/回归，歧义需 owner/file 确认，不按使用次数猜选。

## 后端真实分型

优先例：`D:/projects/T20240246-GMRHCP/T20240246-GMRHCP-Code/trunk/mew-manage`，pom 3.9.1-SNAPSHOT / Java8 / parent 2.2.3-SNAPSHOT；该 parent 不在当前本地 Maven 仓库。完整编译未通过、未执行生产启动。

- `src/main/java/com/topinfo/basic/mew/manage/core/commonbusiness/controller/pc/CMwWarningDirectController.java:23-44,80-97`：实际 RestController、Authorization、list/view/deal、JsonResponse/passKey 调用。
- 同域 `bean/entity/CMwWarningDirect.java` 为普通 Serializable POJO，无 BaseEntity 继承/MP 注解；`mapper/CMwWarningDirectMapper.java` 和 `resources/mapper/commonbusiness/CMwWarningDirectMapper.xml` 手写映射。
- 裸 `jwtpid/jwtaid/jwtCityCode` 方法参数出现只证明调用点，**还未核实可信身份解析器和鉴权完整实现**，不从注释断言安全。
- SOL07 `mine-basic-gov` 的服务/SQL 也有 Java 手工审计、String 日期、ACTIVED=0 逻辑删除；不强制所有业务继承新 BaseEntity 或自动审计。

本地 `.m2` 的 `topinfo-platform-common-2.2.0-SNAPSHOT.jar` 经 javap -c -p 复核：JsonResponse 有 code/message/data/expand、buildSuccess/buildFailure/buildPassKey；成功码 **1**。ErrorCode 字节码的 ordinal=0 不是 code=0。该 JAR 不是缺失的最新平台依赖，不能代替目标 exact 版本证明全面契约。

## SQL

- SOL07 成对 DDL：`MINE_CODE/gov/branches/V1.0/sql/MySQL/V1.0政府端-table-mysql.sql` 与 `sql/达梦/V1.0政府端table-dm.sql`。
- GMRHCP `trunk/mew-data-exchange/mew-data-exchange/sql/all/mysql-schema-all.sql`：varchar(36) 主键、varchar(14) 时间与包含 del_id 的唯一键等。
- 已读旧样本多字符日期，不等于数据库不支持原生日期或新设计必须用字符列。达梦和 MySQL 方言分别处理。

未连接数据库、未执行迁移；正则/映射检查不得写为目标 DB 验证通过。

## 证据使用方式

这些路径是维护者调查记录，不是安装后所有开发人员必须拥有的绝对目录。Skill 使用目标源码与实际版本，安装包不包含这些业务工程或旧规则正文。未核实的 API、身份、数据库运行与最新依赖有明确限制。
