# PaperLab v2.0 — 参赛作品更新方案

> 版本：v2 草案（2026-09-28）
> 前身：PaperLab v0.6.0（基于 DeepSeek Harness 的论文写作智能体）
> 目标：以 **DeepSeek Harness 开源版**（github.com/deepseek-ai/deepseek-harness，Apache 2.0，"Everything is a Plugin"）为底座，将 PaperLab 打磨为一个可参赛、可演示、可一键安装的 **Evidence-First 论文写作智能体**。
> 核心命题：**通过随时可热更新的插件与 Skill，让智能体从想法快速形成一篇可审计、可投稿的论文。**

---

## 一、现状盘点（截至本方案）

### 1.1 已完成且今日实测验证 ✅

| 资产 | 状态 |
|---|---|
| 5 阶段状态机（topic→data→write→audit→submit）+ 3 处 Human Gate + Rollback 回退 | ✅ `tests/smoke-negative.js` 23 项阻断断言全过 |
| 6 类完整性工件 Schema（Ajv **fail-closed**，无软放行） | ✅ smoke 通过 |
| 20 个模型工具（ledger / citation-check / bib-manage / overlap-check / figure-audit / run-branch / auto-review / venue-match …） | ✅ `smoke-v6.js` 通过 |
| 5 个子代理预设（topic-scout / data-forge / paper-writer / paper-auditor / submission-pilot） | ✅ 声明式，随插件挂载 |
| Skill 市场（`paperlab skill install github:owner/repo@tag`，含 manifest.yaml 风险分级 + IO Schema） | ✅ `smoke-skill.js` 通过 |
| PAPERLAB.md 项目记忆注入 + PostToolUse 审计自愈 Hook | ✅ 插件内实现 |
| 端到端演示 `examples/run-paper4.sh` | ✅ 今日实跑 verdict: **PASS, 0 blocking** |
| DSH 集成 | ✅ 今日实跑 `dsh --dump-config --profile headless --patch dsh.plugin.yml` 全绿（本机 dsh 已是 0.1.5-rc.1） |

> 附注：本次盘点顺手修复了 `~/.dsh/profiles/headless/cordis.patch.yml` 中 6 处未加引号的 `@scope/pkg` 包名导致的 YAML 解析失败（改前备份 `/tmp/cordis.patch.headless.bak`）。这正是此前 `smoke-plugin` 报错的根因，与本方案无耦合，但已排除。

### 1.2 与"参赛作品"之间的真实差距 🔴

1. **安装不可一键**：README 的安装方式是往 nvm 的 node_modules 里手工 `ln -sf` + `cp -R` —— 评委机器上跑不起来，是参赛致命伤。
2. **Demo 是 fixture 回放**：`run-paper4.sh` 消费预置工件，缺少"真实现场从 idea 到 PDF"的演示冲击力。
3. **快速成稿的生产力链路未闭环**：LaTeX 编译依赖本机 pdflatex（skill 声明了但没有随包分发引擎）；编译警告未结构化回流审计；写作无段落骨架约束。
4. **知识引擎单薄**：citation-check 只有 CrossRef+arXiv+PubMed 两段式；无 OpenAlex/Semantic Scholar、无引用图谱、无 Gap Analysis。
5. **Peer Review Swarm 被上一轮"先兑现承诺"砍掉**——对参赛来说它恰恰是最有观赏性的环节，应作为 **P2 亮点**重新纳入（且不再犯"设计意图当实现保证"的错误：先写反例测试，再写实现）。
6. **无可视化**：审计radar、证据台账看板、阶段时间线都只在 JSON/CSV 里，评委看不见。

---

## 二、参赛定位与叙事

### 2.1 一句话

> **给 DeepSeek Harness 开源底座装上"学术诚信契约层"：智能体写论文的每一步都不可越界、每个结论都有证据、每个引用都可溯源、每次投稿都需人工放行。**

### 2.2 差异化卖点（评委视角）

| # | 卖点 | 证据/演示方式 |
|---|---|---|
| 1 | **Claim–Evidence Ledger（论点—证据台账）**：任何确定性结论必须携带 evidence_artifact 指针，`draft/gap` 状态不得写成定论 | 现场演示：删除一条证据 → audit BLOCKED → 自愈 Hook 给出精确修复工具调用 |
| 2 | **不可跳级的 5 阶段状态机 + Human Gate** | 现场演示：让模型直接"写完就投" → 被 `checkCanStartStage` 拦截 |
| 3 | **引用幻觉拦截**（Sakana v2 实测 50.9% 引用错误；NeurIPS 2025 发现 100+ 幻觉引用） | 现场演示：注入一条假 DOI → `citation_check` 反查 CrossRef 失败 → 打回 |
| 4 | **Skill 热插拔市场 + K-Dense 164 科学技能桥接** | 现场演示：`paperlab skill install k-dense/<skill>` 一条命令给智能体"上新技能"，立刻改变成稿能力 |
| 5 | **Fail-closed 工程可信度**：23 项反例阻断测试 + 审计结论结构化判定（杜绝正则误报 PASS） | CI 徽章 + 测试面板 |
| 6 | **纯插件、零 fork**：`cordis.patch.yml` 组合到任意 dsh profile | 架构图 + `--patch` 现场演示 |

### 2.3 竞品对照（README 材料直接复用 `_paperlab_capability_audit.md` 数据）

| 能力 | Sakana AI Scientist v2 | 通用编码 Agent (Codex/Claude Code) | K-Dense | **PaperLab v2** |
|---|---|---|---|---|
| 引用核验 | 部分（关键词反查） | 无 | 技能有、无强制 | ✅ 写入前强制 + fail-closed |
| 论点—证据台账 | 无 | 无 | 无 | ✅ 独有 |
| 人工门禁 | 无（曾出现 agent 自改超时） | 仅权限沙箱 | 无 | ✅ topic/audit/submit 三道闸 |
| 审稿模拟 | 单一 reviewer（69% 平衡准确率） | 无 | 无 | ✅ 3 画像 Swarm + Meta-Review + 修订计划 |
| 学科技能生态 | 内置流水线 | 通用 | 164 技能 | ✅ 市场 + K-Dense 桥接（站在 K-Dense 肩膀上） |
| 底座 | 自研沙箱 | 自研 | BYOK 自研 | ✅ DSH 开源，纯插件 |

**诚实边界**（沿用项目立身原则"结论不能强于证据"，写进 README）：PaperLab 目标是 MethodsX/JOSS/SoftwareX 级 protocol 与 workshop 短文的高质量快速成稿 + 全程可审计，不宣称替代顶会级人类科研；自动审稿是辅助信号，投稿决策永远由作者做出。

---

## 三、技术方案

### 3.1 底座决策：DSH 开源版（主选），保留跨 runtime 通道

- **主选 DSH**：已有 20 工具 + 5 预设 + 全套测试的深度集成，零迁移成本；DSH 本身开源（Apache 2.0）、纯 Cordis 插件机制（`--patch`）、自带沙箱/权限/会话恢复/MCP/skill provider —— 论文 agent 需要的"底座五件套"（skill 注册表、plan mode、goal driver、append-only session、subagent spawn）全部现成。
- **不迁移的理由**：`lib/tools/*.js` 全部是纯 Node CLI（不依赖 dsh 内部 API），将来若要适配 Claude Code / Codex / OpenClaw，只需写一层薄适配器 —— 参赛期间不做，但架构上不堵死。
- **版本策略**：`engines: { node: ">=20" }` + 锁定 dsh 兼容版本区间，CI 对 dsh 最新 stable 跑冒烟。

### 3.2 目标架构（v2.0）

```
┌──────────── DSH 开源底座（github.com/deepseek-ai/deepseek-harness）────────────┐
│  Cordis 插件系统 · 5 运行模式(CLI/TUI/Web/Headless/Creator)                      │
│  沙箱与权限 · 会话恢复 · Goal Driver · MCP Client · Skill Provider              │
└───────────────────────────┬──────────────────────────────────────────────┘
                            │ cordis.patch.yml（纯插件，零 fork）
┌───────────────────────────▼──────────────────────────────────────────────┐
│                    PaperLab v2.0 契约层（参赛主体）                          │
│ ① 流程契约：5 阶段状态机 + 3×Human Gate + Rollback/Revise 循环              │
│ ② 证据契约：6 类完整性工件（Ajv fail-closed）+ Claim–Evidence Ledger        │
│ ③ 工具层：20+ 工具（ledger/citation/bib/overlap/figure/branch/review…）    │
│ ④ 生态层：Skill 热插拔市场（git 安装）+ K-Dense 164 科学技能桥接             │
│ ⑤ 质量层：Peer Review Swarm（3 审稿人 + Meta-Review + 修订计划）            │
│ ⑥ 排版层：Tectonic 编译闭环 + VLM 排版审查（PDF 逐页视觉检查）              │
│ ⑦ 呈现层：Web 演示面板（阶段时间线 / Gate 审批 / 台账看板 / 审计雷达图）      │
└───────────────────────────────────────────────────────────────────────┘
```

### 3.3 四周冲刺主线

#### P0（第 1 周）一键化与可复现 —— "评委 5 分钟能跑起来"

- `npx paperlab init`：一条命令完成 dsh profile 组装、插件注册、引擎依赖检测（消除手工 symlink 安装）。
- GitHub Actions CI：5 套测试 + demo 全流程 + dsh 兼容矩阵；README 挂徽章。
- Docker 镜像：内置 Tectonic（单二进制 LaTeX，免 TeX Live），`docker run paperlab demo`。
- Demo 脚本重制：从 fixture 回放升级为**现场生成**（见 P1）。

**验收**：干净机器 `npx paperlab init && paperlab demo` ≤ 10 分钟出 PDF。

#### P1（第 2 周）快速成稿生产力 —— "随时更新的 skill，快速形成一篇论文"

- **结构化写作**：段落骨架约束（Introduction: Hook→Background→Gap→This Work→Contribution），逐段与 ledger 行挂钩，禁止整章一口气生成空话。
- **多源知识引擎**：OpenAlex + Semantic Scholar Graph API 接入 `topic-search` 与 `citation-check`（升级为三段式回退），简版引用图谱 + Gap Analysis。
- **LaTeX 闭环**：Tectonic 替代 pdflatex 依赖；编译 warning/error 结构化后回流 audit 的 `suggestions[]`。
- **VLM 排版审查**：编译 PDF 逐页转图 → 走 dsh 已配置的视觉模型（vision-router 已在 profile 中）→ 拦截 Overfull/图表错位/`??` 引用；与 `figure_audit` 合并成统一排版门禁。
- **K-Dense 桥接**：本机已有 `scientific-agent-skills`（MIT，Agent Skills 标准，164 技能）。做格式适配器使 `paperlab skill install` 可直接安装 K-Dense 技能 —— 一次性把学科技能生态变成演示弹药。

**验收**：现场跑一篇真实短文（候选：① 用户自己的 enrichment-consistency 方向；② "AI 生成论文的可审计性"元论文——素材就是本项目自身的审计数据，最讨巧）从 topic 到 submission 全程 agent 驱动，0 人工改稿，audit PASS，核心 claim 100% 台账覆盖。

#### P2（第 3 周）Peer Review Swarm —— 参赛观赏性担当

- 3 个审稿人子代理（方法学家 / 领域专家 / 挑剔读者），经已注册的 `paperlab-spawn` 并行执行，**先写反例测试再写实现**（吸取上轮教训）。
- 产出 `reviews/reviewer_{1,2,3}.md` + `meta_review.md` + `revision_plan.json`（每条意见映射到具体工具调用：补实验/补引用/改图）。
- audit 阶段的 Human Gate 同时展示三份意见与修订计划；修订可触发合法 rollback 回 write 阶段。

**验收**：一篇带注入缺陷的测试稿（假引用 + 占位图 + 无证据 claim）被 Swarm 全部捕获并生成修订计划。

#### P3（第 4 周）参赛包装

- **Web 演示面板**（收敛升级5：只做演示视图，不做通用大屏）：5 阶段时间线、Human Gate 审批按钮、台账看板、审计雷达图、PDF 实时预览。
- **2 分钟视频脚本**：假 DOI 被拦截的瞬间 → 无证据 claim 卡在 write → 三审稿人集群开火 → `skill install` 现场装新技能 → PDF 产出 + 全程工件一键导出。
- **材料包**：中英双语 README、架构图、对比 benchmark、诚实边界声明、架构决策记录（ADR：为何 DSH、为何 fail-closed、为何 Ledger）。

### 3.4 风险与对策

| 风险 | 对策 |
|---|---|
| 现场模型接入依赖本机 CLIProxyAPI | 参赛环境改用云 API key；视频预录兜底 |
| OpenAlex/S2 API 限流 | 本地缓存 + 离线 fixture 模式（demo `--offline`） |
| LaTeX 编译耗时 | Tectonic 增量缓存；预编译模板包 |
| VLM 审查成本 | 只对 audit 阶段触发，按页数封顶 |
| Skill 市场供应链安全 | 沿用 manifest risk_level；高风险技能需 Gate 确认 |

---

## 四、需要你拍板的三件事

1. **参赛目标**：是哪个比赛/赛道？（截止日期、评审维度、提交格式、是否要求基于特定框架）—— 直接决定 P3 的材料语言与取舍。
2. **演示论文选题**：用你自己的 enrichment-consistency 数据，还是写"可审计 AI 论文写作"元论文（用本项目自身的审计数据当素材）？
3. **现场模型方案**：比赛现场用哪个 provider/key？要不要我先把 demo 做成完全离线可回放模式？

---

## 五、与旧方案（AntiGravity 会话）的继承关系

| 旧路线图项 | v2 处置 |
|---|---|
| 升级1 多源学术知识引擎（S2/OpenAlex/图谱/Gap） | ✅ 保留 → P1 |
| 升级2 BFTS + 结构化写作 | ✂️ BFTS 已有基础工具（run-branch），**收敛**为结构化写作主线 → P1 |
| 升级3 LaTeX + Vision 排版闭环 | ✅ 保留并升级（Tectonic + vision-router）→ P1 |
| 升级4 Peer Review Swarm | ♻️ 上轮被砍，本轮以"测试先行"方式回归 → P2 |
| 升级5 Cordis Service + Web 大屏 | ✂️ 收敛为"演示面板"，不做通用大屏 → P3 |
| 信任底座加固（状态机/fail-closed/结构化判定/回退） | ✅ 已完成，作为参赛的可信度基石与卖点 5 |
