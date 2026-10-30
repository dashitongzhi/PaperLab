# PaperLab v2.1 — DSH × cscience 整合方案

> 版本：v2.1 草案（2026-09-29）
> 前置文档：`PLAN_v2_参赛方案.md`（2026-09-28，四周期 P0–P3 主线全部保留）
> 本方案回答一个问题：**在 DSH（开源底座）与 cscience（Claude Science BYOK 补丁器）同时存在的条件下，PaperLab 该怎么做。**

---

## 〇、一句话结论

**底座用 DSH，cscience 只作对标研究对象，不作为依赖；PaperLab 主体已在 `paperlab/`（v0.7.1），方案 = PLAN_v2 四周冲刺 + 三处修订（cscience 对标研究、演示面板改用 DSH 原生 UI、Review Swarm 落地机制升级）。**

---

## 一、两个开源项目的真实角色

### 1.1 DSH（DeepSeek Harness）= 底座 ✅ 已定

本机正在运行的就是 DSH Desktop（Web GUI @ 127.0.0.1:43120），本地 checkout 位于
`/Applications/DSH Desktop.app/Contents/Resources/app/`。对 PaperLab 有意义的表面：

| DSH 能力 | PaperLab v2 用途 | 现状 |
|---|---|---|
| Cordis 插件系统（`cordis.patch.yml` / `--patch`） | 19+ 工具、system-prompt 注入、skill provider 全部纯插件挂载 | ✅ 已跑通（`dsh --dump-config --profile headless --patch dsh.plugin.yml` 全绿） |
| Skill Provider / `ctx.skills.registerProvider` | Skill 市场接入会话目录 | ✅ 已实现 |
| Subagent spawn（`paperlab-spawn` 预设） | 5 个子代理（topic-scout 等） | ✅ 已注册 |
| **Task Board + cron 定时** | 每日 arXiv 选题侦查、定时审计巡检 | 🆕 v2 新可用 |
| **Agent Teams / workflow 编排** | Peer Review Swarm 的并行落地机制 | 🆕 v2 新可用 |
| **Web GUI 文件卡片（present）** | PDF / 审计报告直接在 GUI 里打开 | 🆕 演示路径 |
| **Hindsight 知识库 / 记忆** | 项目记忆（与 PAPERLAB.md 互补） | 🆕 可选 |
| MCP client + agent-sync | 把 paperlab 工具暴露成 MCP server 供其他 agent 用；反向从其他 agent 导入技能 | 🆕 可选 |

### 1.2 cscience = 对标参照 + UX 弹药库 ⚠️ 不作为依赖

**它是什么（读源码确认）：**

```
cscience
├── download.mjs   下载 Claude Science 的 ~9MB minified bundle
├── patches.mjs    Acorn AST 解析 → 13 个补丁（P1~P13）
├── patch.mjs      打补丁 + 重新解析校验
├── launcher.mjs   本地 server + 打开浏览器
└── templates/byok.env  ANTHROPIC_API_KEY / OPERON_MODELS / BASE_URL
```

13 个补干的事情：绕 OAuth（P1/P4/P12/P13）、`ANTHROPIC_API_KEY` 环境变量回退（P2）、
允许 HTTP 代理（P3）、去掉 provider 限制（P7/P9/P10）、`OPERON_MODELS` 自定义模型列表（P8）等。

**它不是什么：** 不是框架、没有工具系统、没有 skill 机制、没有插件 API。
**Claude Science 本体代码不开源**——cscience 开源的只是补丁器（MIT）。

**能为 PaperLab 提供的三种价值：**

1. **竞品实测（最重要）**：装上真机跑 Claude Science，完整记录它"idea → 文献 → 实验 → 稿件"的产品流：给哪些工具、有哪些质检、有没有引用核验/证据台账/人工门禁。产出《Claude Science 对标笔记》→ 直接进 README 对比表与参赛叙事：
   > *"Anthropic 的 Claude Science 能写论文，但它不给你证据台账、不给你人工门禁、不开源、锁死 Anthropic key；PaperLab 在开源底座上把这三样做成了硬契约。"*
2. **UX 借鉴**：它的界面组织（文献/实验/稿件三区怎么呈现、进度怎么表达）可启发演示层设计。
3. **BYOK 产品化模式**：`byok.env` 五分钟上手、`OPERON_MODELS` 自定义模型列表、`ANTHROPIC_BASE_URL` 代理——PaperLab 的"模型接入"文档照这个体验标准写。

**边界（写进 README 诚实声明）：** 不集成其产物、不再分发补丁后的 bundle、不基于它开发。
理由：① 内核闭源 + 更新即碎（它自己都有 `NO_AUTO_UPDATE` 开关），做依赖等于建在流沙上；
② 参赛底座是 DSH 开源（Apache 2.0），掺入补丁的闭源产物是评审硬伤；③ 需要昂贵的 Anthropic key。

---

## 二、目标架构（v2.1，标注 DSH 承接层）

```
┌──────────────── DSH 开源底座（本机 Desktop + 开源 repo）────────────────┐
│ Cordis 插件 · Web GUI · Task Board+cron · Agent Teams/workflow        │
│ 沙箱权限 · 会话恢复 · MCP · Skill Provider · Hindsight 记忆            │
└──────────────────────────┬───────────────────────────────────────────┘
                           │ cordis.patch.yml（纯插件，零 fork）
┌──────────────────────────▼───────────────────────────────────────────┐
│                 PaperLab v2.1 契约层（参赛主体）                        │
│ ① 流程契约  5 阶段状态机 + 3×Human Gate + Rollback     [已有+增强中]     │
│ ② 证据契约  6 类工件 Schema(Ajv fail-closed) + Ledger  [已有]           │
│ ③ 工具层    20 工具 + OpenAlex/S2 知识引擎升级          [P1]            │
│ ④ 生态层    Skill 市场 + K-Dense 164 技能桥接 + agent-sync [部分已有]    │
│ ⑤ 质量层    Peer Review Swarm（workflow/Teams 并行）    [P2]            │
│ ⑥ 排版层    Tectonic 编译闭环 + VLM 逐页排版审查         [P1]            │
│ ⑦ 呈现层    DSH Web GUI 原生卡片/看板（不自建大屏）       [P3，修订]      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 三、相对 PLAN_v2 的三处修订

### 修订 1：新增 P0.5 —— cscience 对标研究（0.5 天，W1 内）

- `bun install -g @cometix/cscience` → 配 key → 跑通一篇示例。
- 产出 `docs/benchmark_claude_science.md`：工作流步骤清单、工具/质检有无矩阵、截图/录屏素材。
- 同步产出竞赛叙事弹药：对比表加一行 "Claude Science（BYOK 实测）"。
- **红线**：只观察、不集成、不分发。

### 修订 2：P3 "Web 演示面板" 降级为 "DSH 原生 UI 适配"（省约一周）

PLAN_v2 原计划自建演示面板（时间线/Gate 按钮/台账看板/雷达图）。本机 DSH Web GUI 已提供：
任务看板（阶段=卡片列）、文件卡片（PDF/审计报告一键打开）、会话内 markdown 渲染。
改为：写一个 `paperlab board sync` 适配器，把 workflow 状态映射到 DSH task board 列 +
用 `present` 推送工件卡片。评委看到的还是可视化，但我们零自建 UI 成本。

### 修订 3：Review Swarm 落地机制升级（P2）

PLAN_v2 用 `paperlab-spawn` 子代理。本部署里 **workflow 编排 / Agent Teams** 更适合：
3 个审稿人画像并行（fan-out）→ 结构化产出 `reviews/reviewer_{1,2,3}.json` → meta-review 汇聚 →
`revision_plan.json` 每条意见映射到具体工具调用。
**不变的是纪律：先写反例测试（注入假引用/占位图/无证据 claim 的稿子必须被全部捕获），再写实现。**

---

## 四、四周执行计划（修订合并版）

| 周 | 主题 | 关键动作 | 验收 |
|---|---|---|---|
| W1 | **P0 一键化** + P0.5 对标 | `npx paperlab init`；GitHub Actions（5 测试套+demo+兼容矩阵）；Docker(Tectonic)；demo 改现场生成；cscience 对标笔记 | 干净机器 ≤10min 出 PDF；对标笔记入库 |
| W2 | **P1 生产力闭环** | 段落骨架约束写作；OpenAlex+S2 三段式 citation-check；Tectonic 编译 warning 回流 `suggestions[]`；VLM 逐页排版门禁；K-Dense 164 技能桥接 | 一篇真实短文 topic→submission 全程 agent 驱动、audit PASS、claim 100% 台账覆盖 |
| W3 | **P2 Review Swarm** | 反例测试先行；3 画像并行审稿 + meta-review + 修订计划；挂到 audit Gate；支持 rollback 回 write | 注入缺陷测试稿被 Swarm 全部捕获 |
| W4 | **P3 包装** | 双语 README + 对比表（含 Claude Science 实测行）；2 分钟视频（假 DOI 被拦截→Swarm 开火→skill 秒装→PDF）；ADR；DSH 原生 UI 演示路径 | 材料包齐 + 全流程彩排一次过 |

**风险与对策**：沿用 PLAN_v2 §3.4（云 key 兜底、离线 fixture 模式、Tectonic 缓存、VLM 按页封顶、skill 供应链 risk_level）。

---

## 五、第 0 步（立刻可做，与本方案无耦合）

1. **落库未提交改动**：`paperlab/` 当前有 8 个文件未提交（状态机增强 +253 行、`smoke-negative.js` 23 项断言、PLAN_v2 文档）。PLAN_v2 里引用的"✅ 23 项阻断断言全过"对应的就是这批改动——应先跑一遍 `npm run smoke` 全家桶，确认后 commit。
2. `drafts/paper_demo/`（9/28 深夜新建，目前只有 workflow-state.json）确认是否为新的演示论文占位，是则纳入 W2 验收选题候选。

---

## 六、待拍板（沿用 PLAN_v2 三件 + 新增一件）

1. 参赛/比赛目标：哪个赛道？截止日期？是否限定框架？
2. 演示论文选题：enrichment-consistency 真数据 vs "可审计 AI 论文写作"元论文？
3. 现场模型方案：哪个 provider/key？demo 要不要完全离线可回放？
4. **（新）cscience 定位确认**：只作对标、不集成、不分发 —— 同意？
