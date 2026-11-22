# Skill 写法调研与采纳决策

查询日：2026-11-21。范围：4 个 GitHub 仓库，使用仓库 API 和实际文件原文；不是全网排名，也不是“评分最高”。Stars 是关注度时点值，不是质量分。

## 来源快照

复核时间：2026-11-21T07:34:42Z。链接固定到当时 HEAD，避免 main 漂移。

| 仓库 | Stars（复核时） | 固定 HEAD |
|---|---:|---|
| [anthropics/skills](https://github.com/anthropics/skills) | 198,176 | `e4bb5d960d87126ff3b3a8af1a104b7db67560ba` |
| [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | 34,627 | `5a37a6329fbad3666c3207392a6a7c0110e92efb` |
| [obra/superpowers](https://github.com/obra/superpowers) | 323,008 | `22f0b463e7a5e579904dd6211a520321035526f7` |
| [mattpocock/skills](https://github.com/mattpocock/skills) | 329,178 | `abeeaf95660ba9e8b7c753eb38f441ca707a8823` |

Stars 为调研代理实得 API 数据；不据此推出最佳、合规认证或企业批准机制。以下引用来自读过的文件，不把仓库测试宣传当我们的实际运行结果。

## 可借鉴的具体做法

| 证据 | 本项目采纳 | 如何检查 |
|---|---|---|
| [Anthropic skill-creator](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/SKILL.md) 的分级加载、with/without 同轮评测 | 小入口，按端/需求读取参考；评测场景独立于发布包 | SKILL.md ≤150 行、≤20KB；各引用可达；实际演练单列结果 |
| [Vercel React 入口](https://github.com/vercel-labs/agent-skills/blob/5a37a6329fbad3666c3207392a6a7c0110e92efb/skills/react-best-practices/SKILL.md) 与 [单条规则](https://github.com/vercel-labs/agent-skills/blob/5a37a6329fbad3666c3207392a6a7c0110e92efb/skills/react-best-practices/rules/js-early-exit.md) | 情境、正确用法和来源共同放置，不重复所有组件说明 | 每个参考开头写“何时读”；未知不包装成禁止 |
| [Vercel 验证参考](https://github.com/vercel-labs/agent-skills/blob/5a37a6329fbad3666c3207392a6a7c0110e92efb/skills/vercel-optimize/references/verification.md) 区分模型解释与机械断言 | 工具回归检查路径/哈希/范围，不能靠 AI 自评通过 | 实际命令与退出码，未做记录 skipped/not-run |
| [Superpowers 完成前验证](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/verification-before-completion/SKILL.md) | 每类完成声明绑定证据等级 | 静态解析、浏览器、后端编译、SQL 执行分别报告 |
| [Superpowers 体积检查](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/tests/skill-size/test-skill-size.sh) 和 [开发文件隔离](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/tests/skill-layout/test-no-dev-files-in-skills.sh) | 发布 skills 不混测试/演练，限制入口字节数 | check-skills + npm pack 清单 |
| [Matt Pocock research](https://github.com/mattpocock/skills/blob/abeeaf95660ba9e8b7c753eb38f441ca707a8823/skills/engineering/research/SKILL.md) 和 [frontmatter 检查](https://github.com/mattpocock/skills/blob/abeeaf95660ba9e8b7c753eb38f441ca707a8823/scripts/check-frontmatter.mjs) | 事实追到实际源头；安装器/检查器采用同一解析约定 | source 路径/版本与安装预检，受限 scalar YAML 明示 |
| [退役说明](https://github.com/mattpocock/skills/blob/abeeaf95660ba9e8b7c753eb38f441ca707a8823/skills/deprecated/README.md) | 不保留没有价值的旧生成实现，不要求历史过渡层 | 清理仅保留用户文件而非保旧规则；新安装不依赖旧包 |

本地 `writing-great-skills` 也已读取，用于压缩重复、按分支放参考、每步给可检查完成条件。它的具体宿主调用行为不是所有 Agent Skills 平台的统一事实。

## 不搬入

- 不搬一套全量编译规则 AGENTS.md 常驻上下文，避免回到旧 fb-rules 巨型文档模式。
- 不引重型 eval lab、tmux/actor/verifier、自动描述优化循环作为团队使用前置要求；先用本地可复现测试和独立演练。
- 不因高 stars 复制全部流程或多平台壳；当前维护项目级 skills + 已有 Codex plugin 元数据。
- 不把 Anthropic 评测 UI 的“空反馈可视为认可”用于开发批准。**无明确批准就是未批准。**
- 完成验证证据不等于操作人身份证明。四个仓库没有被本次核实为企业身份/审批系统；本项目自行实现本地确认与审计，并如实说明其边界。

## 仍未完成的研究/测评

没有做全网 star 排行、自动触发准确率大样本、稳定性统计或官方宿主认证。采用这些组织方式不等于已经达到某“大厂等级”；质量由实际验收证据决定。
