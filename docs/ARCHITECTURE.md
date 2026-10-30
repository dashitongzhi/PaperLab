# PaperLab 架构白皮书

> 版本：v2.1（2026-09-29）
> 本文是 PaperLab 的完整架构蓝图。标注 ✅ 的组件已在代码中实现并经冒烟测试验证；
> 标注 🔄 的是已规划的设计（对应 PLAN_v2 的 P1/P2/P3），接口位置已预留。
> 底座：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（Apache 2.0，纯插件接入，零 fork）。

---

## 1. 总览：六层契约架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│ L6 呈现层   DSH Web GUI / TUI：banner · 斜杠命令 · 文件卡片 · 任务看板    │
├─────────────────────────────────────────────────────────────────────────┤
│ L5 生态层   Skill 市场（git 安装 · manifest 风险分级）· K-Dense 桥接 🔄    │
│            subagent 预设 ×5 · skill-filesystem 根注入                    │
├─────────────────────────────────────────────────────────────────────────┤
│ L4 质量层   paper_audit.py 结构审计 · citation-check 三源核验             │
│            figure-audit (VLM) · auto-review (LLM-as-judge)              │
│            Peer Review Swarm（3 画像 + meta-review）🔄                    │
├─────────────────────────────────────────────────────────────────────────┤
│ L3 流程层   5 阶段状态机 · 3×Human Gate · rollback 失传播                 │
│            (topic → data → write → audit → submit)                      │
├─────────────────────────────────────────────────────────────────────────┤
│ L2 证据层   Claim–Evidence Ledger · 6 类完整性工件（Ajv fail-closed）     │
├─────────────────────────────────────────────────────────────────────────┤
│ L1 工具层   20 个模型工具（7 shell-out + 13 inline）· CLI 双轨            │
├─────────────────────────────────────────────────────────────────────────┤
│ L0 底座     DSH：Cordis 插件系统 · 沙箱/权限 · 会话 · MCP · skill provider │
└─────────────────────────────────────────────────────────────────────────┘
```

设计原则只有一条：**结论不能强于证据**。每一层都是这条原则在某个切面上的强制执行——
L3 强制"流程不能跳级"，L2 强制"claim 必须带证据指针"，L4 强制"审计必须可机读"。

---

## 2. L0 底座层：DSH 提供什么、PaperLab 怎么挂上去

PaperLab 与 DSH 的关系是**纯插件组合**（`cordis.patch.yml`），不改 DSH 一行源码：

```yaml
# paperlab/cordis.patch.yml（Loader PatchOptions 数组）
- insert:
    - id: paperlab-plugin                # ① Cordis 插件入口 → apply() 注册一切
      name: '@kral/paperlab-plugin'
- id: paperlab-skill-filesystem          # ② 原地覆盖 dsh-base 的 skill-fs 行，
      config:                            #    追加 PaperLab skills/ 根（不插第二行，
        roots:                           #    避免 duplicateError 崩溃）
          - /Users/kral/project/papers/paperlab/skills
- id: paperlab-subagent-spawn            # ③ 注册命名子代理 provider
  name: '@deepseek-ai/dsh-subagent-spawn-in-process'
  config: { providerName: paperlab-spawn }
```

插件 `apply(ctx)` 挂载的六个 DSH 框架表面（全部公共 API）：

| DSH API | PaperLab 用它做什么 | 代码 |
|---|---|---|
| `ctx.tools.register(defineTool(...))` | 注册 20 个模型工具 | bundle `plugin/lib/index.js` |
| `ctx.systemPrompt.section({name, order, text})` | 注入两段系统提示：`paperlab-pipeline`(order 50) + `paperlab-md`(order 51，PAPERLAB.md 内容) | 同上 |
| `ctx.systemPrompt.slashCommand(...)` | 7 个斜杠命令：`/paperlab-{topic,data,write,audit,submit,status,explore}` | 同上 |
| `ctx.skills.registerProvider(...)` + `invalidateCache()` | Skill 市场provider；`fs.watch(~/.paperlab/marketplace/)` 热更新目录 | `lib/plugins/skill-sync.js` |
| `ctx.subagents.spawn`（可用时） | 5 预设按阶段路由 spawn | `lib/plugins/subagent-spawn.js` |
| `ctx.tools.observe(toolName, args, result)` | **审计自愈 hook**：拦截 `paperlab_paper_audit` 结果，把 BLOCKED 发现解析成结构化 `suggestions[]`（= Claude Code PostToolUse 语义） | `lib/plugins/hooks.js` |
| `ctx.session.banner(fn)` | 会话横幅：paper 目录 · 当前阶段 · 模型 · 斜杠命令 | 同上 |

**明确不用的 DSH 表面**（记录在 DSH_INTEGRATION.md §11，防止后人重复踩坑）：
dsh-goal round driver（无阶段语义，故自建状态机）、dsh-agent-presets（避免污染全局预设表）、
dsh-tools SDK 代码生成与 presentation cards（纯 JSON 输出足够）。

---

## 3. L3 流程层：5 阶段状态机（`lib/orchestrator/state.js`）

### 3.1 状态转移

```
                   rollback（任意时刻回退到严格更早的阶段；
                   目标阶段及之后的所有 completed 标记与 gate 批准全部失效）
      ┌──────────────────────────────────────────────────────────────┐
      │                                                              ▼
┌───────┐ complete ┌──────┐ complete ┌───────┐ complete ┌───────┐ complete ┌────────┐
│ topic │────────▶│ data │────────▶│ write │────────▶│ audit │────────▶│ submit │
│ ★GATE │          │      │          │       │          │ ★GATE │          │ ★GATE  │
└───────┘          └──────┘          └───────┘          └───────┘          └────────┘
  ★GATE = Human Gate：decision 必须为 approved 且未被 invalidate，后续阶段才允许 start
```

### 3.2 核心不变量（全部由代码强制，23 项反例测试覆盖 ✅）

| 不变量 | 强制机制 |
|---|---|
| 不能跳级 | `checkCanStartStage`：目标阶段之前的每个阶段必须 `rounds[s].completed === true` |
| 不能绕闸 | 前置 Human-Gate 阶段必须 `gate.decision === 'approved' && !gate.invalidated` |
| 单活动阶段 | `wf.stage` 非空时不得 start 其它阶段，必须先 complete 或 rollback |
| 回退必失效 | `rollbackStage` 把目标及之后的 `completed` 置 false、gate 置 `invalidated=true` + `decision='needs_revision'`，且只能回退到**严格更早**的阶段 |
| 状态可恢复 | 每次转移即写盘 `<paper>/evidence/workflow-state.json`，headless/CLI/重启都无损 |
| 历史不撒谎 | 全部事件进 `history[]`（上限 200 条，追加式） |

### 3.3 Human Gate 语义

`recordGate(stage, decision ∈ {approved, rejected, needs_revision, deferred}, reviewer, conditions, notes)`
→ 落盘 `evidence/human-review-gates.jsonl`（schema 强制 `reviewer` 与 `decided_at` 非空：**谁、何时、凭什么条件**放行，可审计）。

### 3.4 驱动接口（模型可见的工具）

| 工具 | 行为 |
|---|---|
| `paperlab_drive_stage --stage <s>` | startStage：先查 canStart，拒绝时返回**结构化 reason** |
| `paperlab_complete_stage` | completeStage：关闭当前阶段，附 summary + 工件指针 |
| `paperlab_rollback_stage --to <s> --reason <r>` | 合法回退（audit 打回 → write 修订的正规通道） |
| `paperlab_human_gate --stage --decision` | 记录人工决策 |
| `paperlab_session_status` | 读当前 workflow + ledger + audit 三态，**每个会话第一个调用** |

---

## 4. L2 证据层：6 类完整性工件 + 台账

### 4.1 工件类型与 JSON Schema（`schemas/v1/`，Ajv 校验 **fail-closed**：校验器加载失败=拒绝写入，不存在软放行）✅

| # | 工件 | 必填字段 | 落盘 |
|---|---|---|---|
| 1 | `workflow-state` | run_id, started_at, dsh_version, …tools/skills/model | `evidence/workflow-state.json` |
| 2 | `literature-provenance` | id, search_terms, databases, search_date, status (+inclusion/exclusion criteria, stable_ids) | `evidence/literature-provenance.jsonl` |
| 3 | `citation-verification` | citation_key, status (+doi/arxiv_id/bibtex_hash/mismatch_notes) | `evidence/citation-verification.jsonl` |
| 4 | `experiment-traceability` | experiment_id, inputs, code, output (+env, random_seed) | `evidence/experiment-traceability.jsonl` |
| 5 | `human-review-gates` | gate_id, stage, decision, reviewer, decided_at | `evidence/human-review-gates.jsonl` |
| 6 | `claim-evidence-row` | claim_id, claim_text, evidence_status, section | `evidence/claim_evidence_ledger.csv` |

### 4.2 Claim–Evidence Ledger（`lib/integrity/ledger.js`）——整个系统的脊柱 ✅

RFC 4180 CSV，每行一个论点：

```
claim_id | section | claim_text | evidence_status ∈ {supported, draft, gap}
        | evidence_artifact_type | evidence_artifact_pointer   ← 必须指向真实工件
        | reviewer | updated_at
```

两条铁律（audit 阶段强制）：
1. **`draft` / `gap` 状态的 claim 不得写成确定结论**——正文出现定论式表述而台账状态非 `supported` → BLOCKED；
2. **精确数字必须可追溯**到表格 / 图 / 代码输出 / 已核验文献。

写入路径统一过 `paperlab_integrity_check`（先 Ajv 校验 claim-evidence-row 再落盘）；
ledger.save() 时把结构化列**镜像**为 `paper_audit.py` 期望的扁平列
（`status ← evidence_status`，`evidence_artifact ← "type:pointer"`），保证新旧工具链互通。

---

## 5. L1 工具层：20 个模型工具 + CLI 双轨 ✅

**双轨原则**：7 个核心工具 shell-out 到 `bin/paperlab.js`（14 个子命令的独立 CLI），
因此**离开 DSH 也能用**（CI、脚本、其他 agent）；13 个编排/分析工具在插件进程内联执行。

| 阶段 | 工具 | 类型 | 契约要点 |
|---|---|---|---|
| any | `paperlab-session-status` | inline | 会话第一调用：workflow + ledger + audit 三态快照 |
| any | `paperlab-todo` | inline | 论文任务清单（区别于会话 todo） |
| any | `paperlab-ledger-read/write` | shell | 台账读写；写前强制 schema 校验 |
| any | `paperlab-integrity-check` | shell | 单行 claim-evidence-row 校验 |
| any | `paperlab-paper-audit` | shell | 跑 `paper_audit.py` 结构+证据卫生审计 |
| any | `paperlab-venue-match` | shell | MethodsX / JOSS / SoftwareX / arXiv 模板返回 |
| any | `paperlab-dataset-manifest` | shell | sha256 + `manifest.json` + `traceability.json` |
| topic | `paperlab-topic-search` | shell | arXiv Atom XML → 结构化命中（title/authors/abstract/DOI）🔄 升级三源 |
| topic/data/write/audit/submit | `paperlab-drive/complete/rollback-stage` | inline | 状态机驱动（见 §3.4） |
| audit | `paperlab-audit-run` | inline | audit + BLOCKED→`suggestions[]`（每条=下一个该调的工具） |
| any | `paperlab-human-gate` | inline | 人工决策落盘 |
| any | `paperlab-citation-check` | inline | CrossRef→arXiv→PubMed 两段式回退 🔄 升级三段式（+OpenAlex/S2） |
| any | `paperlab-bib-manage` | inline | refs.bib list/add/dedupe/format/gap_analysis |
| data | `paperlab-overlap-check` | inline | 数据集两两 Jaccard 行哈希，>5% 拒绝（train/test 泄漏闸） |
| write | `paperlab-figure-audit` | inline | VLM 审图：缺标签/占位符/不可读图例 → 拒绝推进 |
| data | `paperlab-run-branch` | inline | 子实验分支 + 新颖度/通过率打分（BFTS 式） |
| audit | `paperlab-auto-review` | inline | LLM-as-judge 按目标期刊评审表打分 |

**失败协议**（所有工具统一）：拒绝时返回结构化 `{blocked: true, reason, suggestion: {tool, args}}`，
模型拿到的是**下一个动作**而不是一句报错——这是"审计自愈"闭环的一半，另一半是 §2 的 observe hook。

---

## 6. L4 质量层：三道防线

```
防线一（写入前）  citation-check · overlap-check · figure-audit · integrity-check
                  —— 坏数据进不了 manuscript
防线二（阶段尾）  paper_audit.py：结构完整性 + 台账覆盖率 + placeholder 扫描
                  → audit_report.md（PASS/BLOCKED + 发现清单）
                  → observe hook 解析为 suggestions[]（自动给出修复工具调用）
防线三（Gate 前）  auto-review（期刊 rubric）🔄 + Peer Review Swarm
```

### Peer Review Swarm（🔄 P2，接口已预留）

```
audit 阶段触发
 ├─ reviewer-1 方法学家（实验设计/统计效力/复现性）
 ├─ reviewer-2 领域专家（novelty/相关工作覆盖）
 ├─ reviewer-3 挑剔读者（逻辑跳跃/过度声称/可读性）
 │    └─ 三者并行 fan-out（DSH workflow / Agent Teams），结构化产出：
 │       reviews/reviewer_{1,2,3}.md
 ├─ meta-review：汇聚分歧 → reviews/meta_review.md
 └─ revision_plan.json：每条意见映射到具体工具调用（补实验/补引用/改图）
      → 需要改稿 → paperlab_rollback_stage --to write（合法回退通道）
```

落地纪律：**先写反例测试**（注入假引用 + 占位图 + 无证据 claim 的测试稿必须被全部捕获），再写实现。

---

## 7. L5 生态层：Skill 市场 + 子代理

### 7.1 Skill 市场架构 ✅

```
paperlab skill install github:owner/repo@tag     ──┐
paperlab skill install <repo-tree-url>             ├─▶ installer.js
paperlab skill install --from ./local-dir        ──┘      │ 校验 manifest.yaml（Ajv）
                                                            ▼
manifest.yaml（市场契约，比 Anthropic Agent Skills 标准多出的字段）：
  risk_level: low|medium|high      # high 需 Human Gate 确认才启用
  inputs_schema / outputs_schema   # IO 契约
  depends_on: [tools…]             # 声明依赖的 paperlab 工具
  entry_point:                     # 入口（SKILL.md / 脚本）
                                                            │
                                                            ▼
store: ~/.paperlab/marketplace/<skill>/  ──fs.watch──▶ ctx.skills.invalidateCache()
                                                            │
indexer / viewer ◀──────────────────────────── DSH 会话 skill 目录实时热更新
```

CLI：`paperlab skill list/search/info/view/install/uninstall/publish`（`bin/paperlab-skill.js`）。
`view` 支持安装前预览 SKILL.md；`publish` 校验 manifest 并给出推送指引。

内置 5 技能（随插件分发）：`topic/arxiv-search`、`data/dataset-manifest`、`write/latex-compile`、
`audit/citation-check`、`submit/venue-templates`；另带 3 个示例（含 `enrichment-consistency`）。

### 7.2 K-Dense 桥接（🔄 P1）

本机 `scientific-agent-skills/`（MIT，164 个学科技能，Agent Skills 标准）→ 写一个格式适配器，
让 `paperlab skill install` 直接装 K-Dense 技能（补 manifest 缺失字段：risk_level 默认、IO schema 推导）。
一次性把学科技能生态变成工具面。

### 7.3 子代理层 ✅

| 阶段 | 预设 | 职责（system prompt 在 `lib/subagents/*.system.md`） | dsh preset |
|---|---|---|---|
| topic | `topic-scout` | 选题侦查、可行性、数据可得性 | `agent-presets/topic-scout/` |
| data | `data-forge` | 数据集获取、清洗、manifest、traceability | `agent-presets/data-forge/` |
| write | `paper-writer` | 段落骨架约束写作、逐 claim 挂台账 🔄 | `agent-presets/paper-writer/` |
| audit | `paper-auditor` | 审计执行、suggestions 分诊、修订路由 | `agent-presets/paper-auditor/` |
| submit | `submission-pilot` | 模板适配、cover letter、打包 | `agent-presets/submission-pilot/` |

路由表 `ROUTING = {topic: topic-scout, data: data-forge, …}`；
`ctx.subagents.spawn` 可用则真 spawn，否则返回元数据由父代理直接执行（降级路径）。

### 7.4 项目记忆：PAPERLAB.md ✅

论文根目录的 `PAPERLAB.md`（frontmatter: research_question / target_venue / hard_constraints /
methodology_choice / related_work）由 `lib/plugins/paper-md.js` 在会话启动时注入 system prompt
order 51——跨会话的项目级记忆，协议规范见 `PAPERLAB.md.protocol.md`。

---

## 8. 排版闭环（🔄 P1，write→audit 之间的物理门禁）

```
manuscript/main.tex
   │ tectonic（单二进制 LaTeX，替代 TeX Live 依赖）
   ▼
main.pdf ──逐页转图──▶ VLM 排版审查（只挂 audit 阶段，按页数封顶成本）
   │                      拦截：Overfull hbox / 图表错位 / "??" 未解析引用 / 占位文本
   ▼
编译 warning/error 结构化 ──▶ 回流 audit suggestions[]（与 paper_audit.py 发现同通道）
```

## 9. L6 呈现层：不自建 UI，映射到 DSH 原生表面 🔄

| 需要呈现的 | DSH 原生表面 |
|---|---|
| 会话状态横幅（paper 目录/阶段/模型） | `ctx.session.banner` ✅ |
| 阶段驱动入口 | 7 个斜杠命令 ✅ |
| 5 阶段进度 | task board 列映射（`paperlab board sync` 适配器 🔄） |
| PDF / 审计报告 / 台账 | 文件卡片（present）🔄 |
| Skill 安装观测 | skill 目录热更新 ✅ |

---

## 10. 一次完整 Run 的数据流

```
$ dsh --profile <p> "用 PaperLab 把 drafts/paper_demo 推到 submission"

idea
 │ drive_stage(topic)                    evidence/workflow-state.json: stage=topic
 ├─ topic-search (arXiv/OpenAlex)  ──▶  evidence/literature-provenance.jsonl
 ├─ 初始化 PAPERLAB.md（研究问题/目标期刊/硬约束）
 ├─ human_gate(topic, approved, reviewer=kral) ──▶ evidence/human-review-gates.jsonl
 ▼ complete_stage(topic)
data
 ├─ dataset_manifest(ds.csv)       ──▶  data/manifest.json + sha256
 ├─ experiment traceability        ──▶  evidence/experiment-traceability.jsonl
 ├─ overlap_check(train, test)           ≤5% 才放行
 ▼ complete_stage(data)
write
 ├─ 段落骨架逐段写作，每段 claim：
 │    ledger_write(...)             ──▶  evidence/claim_evidence_ledger.csv
 ├─ citation_check(每条 \cite)      ──▶  evidence/citation-verification.jsonl
 │    （CrossRef 失败→arXiv→PubMed 回退；全失败=拒绝入 refs.bib）
 ├─ bib_manage(dedupe/format)      ──▶  refs/refs.bib
 ├─ figure_audit(fig1.pdf)               VLM 拦占位图
 ▼ complete_stage(write)
audit
 ├─ paper_audit + audit_run        ──▶  checks/audit_report.md
 │    BLOCKED? → suggestions[] → 修复 → 重跑（或 rollback(write)）
 ├─ auto_review(MethodsX rubric)
 ├─ [P2] Review Swarm ×3 + meta    ──▶  reviews/*.md + revision_plan.json
 ├─ human_gate(audit, approved, conditions=[...])
 ▼ complete_stage(audit)
submit
 ├─ venue_match(MethodsX) → 模板适配
 ├─ 打包 manuscript+figures+bib     ──▶  submission/
 ├─ human_gate(submit, approved)    ←    最后闸门：投稿决策永远是人
 ▼
workflow-state.json: pipeline finished（全程工件可一键导出复审）
```

## 11. 论文目录约定（每篇论文一个自包含工作区）

```
<paper>/
├── PAPERLAB.md                        # 项目记忆（注入 system prompt）
├── evidence/                          # 全部完整性工件（审计的物理载体）
│   ├── workflow-state.json
│   ├── claim_evidence_ledger.csv      # 脊柱
│   ├── literature-provenance.jsonl
│   ├── citation-verification.jsonl
│   ├── experiment-traceability.jsonl
│   ├── human-review-gates.jsonl
│   └── sources.csv
├── data/                              # 数据集 + manifest.json + traceability.json
├── manuscript/main.tex
├── refs/refs.bib
├── figures/
├── checks/audit_report.md
├── reviews/                           # [P2] Swarm 产出
└── submission/
```

## 12. 仓库结构与测试防线

```
paperlab/
├── bin/paperlab.js            # 独立 CLI（14 子命令）——脱离 DSH 也能跑
├── bin/paperlab-skill.js      # 市场 CLI
├── lib/
│   ├── orchestrator/state.js  # 状态机（§3）
│   ├── integrity/             # ledger + 6-schema fail-closed 校验器
│   ├── tools/                 # 20 个工具定义（纯 JSON Schema，框架无关）
│   ├── plugins/               # dsh 挂载胶水：hooks / paper-md / skill-sync / subagent-spawn
│   ├── skill/                 # manifest / store / installer / indexer / viewer
│   └── subagents/             # 5 个 system prompt
├── schemas/v1/                # 6 个 JSON Schema（唯一真相源）
├── skills/                    # 内置 5 + 示例 3
├── agent-presets/             # 5 个 dsh 预设（agent.cordis.yml + preset.yml）
├── examples/run-paper4.sh     # 端到端 demo
├── cordis.patch.yml           # DSH 挂载点
├── dsh.plugin.yml             # 开发 --patch overlay
└── tests/                     # smoke ×4 + smoke-negative（23 项反例断言）
```

**测试策略**：正例冒烟（35+35+30+22 断言）+ **负例阻断**（23 项：跳级必拒、未批闸必拒、
假 DOI 必拒、超阈值 overlap 必拒、rollback 必失效、schema 坏行必拒）。原则：**每个"必须拦住"
的保证都要有一条会红的测试**，杜绝正则误报 PASS。

## 13. 扩展点与边界

| 想扩展什么 | 动哪里 | 不用动 |
|---|---|---|
| 新工具 | `lib/tools/*.js` 加一个纯 JSON-Schema 定义 + index 注册 | dsh、其他工具 |
| 新工件类型 | `schemas/v1/` 加 schema + checker 注册 | ledger、状态机 |
| 新技能 | 任意 git repo 放 SKILL.md + manifest.yaml | 本仓库 |
| 新审稿人画像 | `lib/subagents/` 加 system md | 路由表一处 |
| 新期刊模板 | `skills/submit/venue-templates/` | — |
| 换 LaTeX 引擎 | 排版闭环实现（tectonic 可换 latexmk） | 审计通道 |
| 换底座（Claude Code/Codex 适配） | 只重写 `lib/plugins/` 胶水层 | 全部 lib/tools、schemas、状态机 |

**诚实边界**（写进 README 的立身声明）：PaperLab 目标是 MethodsX / JOSS / SoftwareX 级
protocol 与 workshop 短文的高质量快速成稿 + 全程可审计；不宣称替代顶会级人类科研；
自动审稿是辅助信号，投稿决策永远由作者做出。
