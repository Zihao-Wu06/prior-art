# Prior Art

**「先查先例，再造轮子」**

Prior Art 是一个证据引擎：在 AI coding agent 动手写代码之前，先逼它做一次"现有技术检索"——查有没有现成方案能满足需求，也查要新加的依赖是否经得起尽调，最后留下一条可审查的决策记录。今天能用的是复用阶梯、依赖尽调报告、决策注记和 ADR；v0.2 会加上"重造轮子审计"，v0.3 加发现引擎（MCP server + 知识包），v0.4 加 GitHub Action 和公开的 Wheel Reinvention Index。

[English README](../README.md)

## 为什么做

AI agent 在这件事上会犯两种方向相反的错误：

**重复造轮子**——手搓日期选择器、自研鉴权、为三行需求拉出一整棵依赖树。标准库、平台原语、已经装好的依赖往往早就覆盖了这些需求，只是 agent 没有实时检索的习惯，想不到去查。

**乱加依赖**——另一个方向同样危险。不经尽调就引入维护状态不明、许可证不兼容、甚至带供应链风险的包。left-pad、xz-utils 这类事件不是孤例，是会重复发生的模式。

Prior Art 不推销库，也不鼓吹"能自己写就别装依赖"的极简主义。它是尽调官：不管 agent 往哪个方向倾斜，都要求同样的证据和记录。

## 快速开始

```bash
npx priorart init
pa report zod
```

在 Claude Code 里：

```
/plugin marketplace add zihaowu/prior-art
/plugin install prior-art@prior-art
```

## 复用阶梯（8 级）

停在第一个能满足需求的梯级，不要往上爬：

0. **do-nothing** —— 需求是投机性的，先别做。
1. **built-in** —— 语言或标准库已经覆盖。
2. **native-platform** —— 浏览器/操作系统/数据库/框架/协议原语已经覆盖。
3. **installed-capability** —— 已装依赖、已连接的 MCP server、或已装 skill 已经覆盖。
4. **existing-solution** —— 有现成的整个项目或自托管方案可以直接用或 fork。
5. **open-source** —— 引入一个成熟的新开源库。
6. **commercial** —— 花钱买可靠性、合规或时间。
7. **in-house** —— 自己造，因为这就是差异化本身。

每个选择还带一个集成模式——**adopt / extend / compose / build**——回答"怎么用"，和"用哪一级"是两个正交的问题。

## 今天能用什么 / 路线图

| 版本 | 内容 |
|---|---|
| **v0.1**（现在） | `pa report <pkg>`（覆盖 7 个生态）· `pa init` · `pa adr new` / `pa adr list` · `pa stats`（台账）· Claude Code 插件（Gate skill + ADR skill + 三层 hook） |
| v0.2 | `pa audit` —— 重造轮子审计 |
| v0.3 | `pa search`、MCP server、知识包 |
| v0.4 | GitHub Action、基准测试跑分器、公开的 Wheel Reinvention Index |

## 灵敏度分级

烦人是这类工具被卸载的头号原因，所以门控默认克制，只在你配置的范围内升级。

| 级别 | 行为 |
|---|---|
| `off` | 不触发任何 hook。 |
| `light` | `SessionStart` 只注入压缩版阶梯上下文。 |
| `standard` | 在 `light` 基础上，`UserPromptSubmit` 对"build/实现"类请求加一层提示级门控。 |
| `strict` | 在 `standard` 基础上，`PreToolUse(Write)` 加一次性提醒——每会话每能力最多一次。 |

## 致谢与许可

概念上受这些项目启发：[buy-vs-build](https://github.com/stdin/buy-vs-build)、[reuse-before-build](https://github.com/ShanedevPro/dont-reinvent-the-wheel-skill)、[ECC search-first](https://github.com/affaan-m/ECC/blob/main/skills/search-first/SKILL.md)；Prior Art 在此基础上加了发现、检测和证据三层。

许可协议：MIT。
