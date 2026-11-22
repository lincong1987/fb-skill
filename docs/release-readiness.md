# 发布就绪表 · 0.2.1

**结论：可交付内部私有验证包；暂不宣称全栈正式验收或公共发布就绪。** 本轮不commit/push、远端CI、公共npm/GitHub发布或授予开源许可。

| 范围 | 本轮实际结果 | 证据 / 限制 |
|---|---|---|
| 真实批准与留痕 | 已完成 | 真实宿主方案结果、原计划/哈希、准确派生scope；项目显示标签一次保存。不是实名/IAM或宿主签名 |
| Node18/20/24同套回归 | 各238pass、0fail、5skip | 版本18.20.8/20.19.6/24.16.0；`final-regression-20261122-01` 的各report/log；跳过不算通过 |
| 无额外依赖根 | 225pass、0fail、18skip | 本机仍有GMRHCP和已有产物，不称全无环境 |
| 大屏合成GUI | 8/8pass | 真实主题/图表、缩放、轮询、销毁和remount；真实地图服务/视频player未测 |
| MySQL合成实例 | 26/26pass、进程正常退出、端口释放 | 5.7.26、loopback18735；03报告。前两次失败保留；绑定依据服务日志/PID和runtime，OS独立socket证据不可得 |
| Java合成契约 | 43/43pass，真实JDK编译运行 | 纯JDK样例，XML只检查文本；不替代Spring/MyBatis/准确TopInfo工程 |
| 实际tgz消费者 | 最终包全新隔离消费者离线安装/重复安装/精确清理/自定义保留/CLI通过 | 包与zip的SHA256见包外SHA256SUMS清单（避免文档自引用hash）；安装清理实测见consumer-smoke-06报告；宿主发现实测仍基于smoke03的pack05 |
| Codex0.167.0宿主发现 | 三项目Skill发现成功 | 最新smoke03实际skills/list；完整调用仍blocked，不能拿发现替代触发 |
| 公告本地mock | 两轮wx记录：first 17pass/6partial/3not-run/1fail（fail冻结）；唯一整改轮repaired **26pass/1partial/0fail**，A19删除锁修复双路径GUI复验，resultHash=`da7882c8…` | A27=partial（初始加载失败分支受公开mock契约限制无法注入，查询期两种失败已官方验证）；mock验收不等于真实后端/文件服务/旧页像素 |
| 达梦合成实例 | 已实际尝试，fail / blocked；18项必要SQL检查未执行 | DM-04准确配置与runtime回读均为127.0.0.1/18736/关闭IPv6，但三个非环回本机地址实际保持连接，未满足仅本机范围；已停止自身进程并释放端口，原报告不改 |
| 移动H5/native | blocked / not-run | 准确TA/uni包内部仓库不可达且无缓存；无可用HBuilderX。不换版本或借PC代替 |
| 准确Java2.2.3工程 | blocked | 6缺依赖探测0resolved、关联旧模块build失败；不能用2.2.0或合成stub替代 |
| Codex显式调用/自然触发 | blocked / not-run | 首次读取被host policy拒，旁路被主中止；未改政策或代批准 |
| 真实接口/文件服务/业务DB/旧页像素对照 | not-run | 不属于本轮mock验收；前端权限不证明后端鉴权，单案例不建立总体准确率 |

## 交付与后续条件

版本、plugin和bundle均为0.2.1；`private:true`、`UNLICENSED` 不擅自改开源许可。提供本地tgz/zip、SHA256、安装指南和原始证据索引；包不含tests/evals/临时输出/参考业务源码/旧zip。

移动和准确Java需要恢复准确内部仓库/依赖；宿主完整调用需要宿主允许专用读取路径，不能绕过被拒命令。条件具备后只补对应验证，不重写本轮失败和未做记录。

完整命令、路径和分层边界见 [验证报告](validation.md) 第10节；用户指南见 [README](../README.md) 和 [需求提交指南](requirement-guide.md)。发布包的SHA256在包外清单记录，避免文档内自引用的hash循环。
