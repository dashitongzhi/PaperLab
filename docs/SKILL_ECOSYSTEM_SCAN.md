# PaperLab 技能生态调研 — GitHub 高星科研/论文项目扫描

> 调研日期：2026-09-29 · 方法：GitHub CLI + MCP 仓库搜索（star 排序，多品类交叉）
> 目的：为 PaperLab 的 Skill 市场与 L5 生态层收集弹药；评估哪些项目值得桥接、集成或对标。

---

## 一、核心发现总表

### A. 科学技能库（Skill 生态直接弹药）

| 项目 | 星数 | 是什么 | PaperLab 用法 | 优先级 |
|---|---|---|---|---|
| **K-Dense-AI/scientific-agent-skills** | 46,975★ | 165 个验证科学技能 + 100+ 数据库（生物/化学/医学/药物），Agent Skills 标准，兼容 Cursor/Claude Code/Codex | **已本地克隆**（`/Users/kral/project/papers/scientific-agent-skills`）。写 manifest 适配器 → `paperlab skill install` 直接安装 | ⭐⭐⭐ |
| **google-deepmind/science-skills** | 新(2026-05) | DeepMind 官方：AlphaGenome/AFDB/UniProt 等 30+ 数据库集成的 agentic 科研技能 | 桥接目标（生命科学领域能力大幅补强） | ⭐⭐ |
| **LeonChaoX/qinyan-academic-skills** | — | 182 个端到端学术技能（文献发现→科学写作→基金申请→生信→药物→临床→ML） | 中文社区最全学术技能集，中文学术写作技能来源 | ⭐⭐ |
| **InternScience/Awesome-Scientific-Skills** | — | 精选科学 Agent Skills 目录 | 技能发现渠道，纳入市场索引 | ⭐ |
| **ComposioHQ/awesome-claude-skills** | 75,783★ | Claude 技能总目录 | 市场索引上游源 | ⭐ |

### B. AI 科学家系统（架构对标）

| 项目 | 星数 | 借鉴点 |
|---|---|---|
| **SakanaAI/AI-Scientist** | 14,636★ | 端到端科研发现阶段划分（idea gen → exp → write → review）；引用核验缺失的教训（README 已引用其 50.9% 引用错误率） |
| **SakanaAI/AI-Scientist-v2** | 7,234★ | BFTS（agentic tree search）——`paperlab_run_branch` 已实现简版；reviewer 画像（69% 平衡准确率的教训 → Swarm 设计） |
| **microsoft/RD-Agent** | — | 微软 R&D 自动化：数据/模型双轮驱动框架，CoT 研究报告产出管线 |
| **EvoScientist** | 5,026★ | 自进化 AI 科学家（技能自我改进循环） |
| **dwzhu-pku/PaperBanana** | 7,126★ | 学术插图自动生成（figure 阶段的补充技能） |
| **aipoch/open-science** | — | 科研工作台桌面应用（竞品对标：local-first + 技能 + MCP + Python/R 执行 + 可追溯工件——**与 PaperLab 六层架构高度同构，需持续观察**） |

### C. 文献与引用工具（citation-check / bib-manage 升级弹药）

| 项目 | 星数 | 用法 |
|---|---|---|
| **54yyyu/zotero-mcp** | — | Zotero 文献库 MCP 接入：检索/摘要/引用分析 → 接入 PaperLab MCP client 面 |
| **TideDra/zotero-arxiv-daily** | — | 按个人 Zotero 库个性化推荐 arXiv 日报 → topic 阶段订阅式选题侦查（配 DSH task board cron） |
| **kaixindelele/ChatPaper** | 19,878★ | 论文总结+翻译+润色+**审稿+审稿回复**全流程（中文社区最大）——审稿 prompt 生态参考 |
| **zotero/translators** | — | 700+ 站点元数据抓取 translator 体系——citation 元数据回填参考 |

### D. LaTeX 与模板（venue-templates / 排版闭环弹药）

| 项目 | 星数 | 用法 |
|---|---|---|
| **ElegantLaTeX/ElegantPaper** | — | Working paper 模板 → `skills/submit/venue-templates` 收录 |
| **rstudio/rticles** | — | R Markdown 期刊模板集（几十种期刊）→ 模板库扩充来源 |
| **kourgeorge/arxiv-style** | — | arXiv 预印本样式（NIPS 基础）→ 收录 |

### E. 前端已实现（本次会话产出）

web profile 现已挂载两个 PaperLab UI 插件（`~/.dsh/profiles/web/node_modules/@paperlab/`）：

- **@paperlab/ui-brand** — 侧边栏品牌位（绿 P 徽标 + 渐变 PaperLab 字）
- **@paperlab/skills-panel** — 五阶段流水线面板：读工作区 `evidence/workflow-state.json`（经公共 workspaceFiles Remote API），渲染阶段进度 ✓/进行中、Human Gate 徽章（已批/待批/驳回）、最近事件；10s 自动刷新
- 技术要点：DSH client 插件必须用 `window.__ModuleLoader__.load({id, factory})` 经典脚本格式（非 ESM），slot 契约 `sidebar.brand.mark/name`、`sidebar.panellist`、`main`(keyed)；面板经 `ctx.layout.selectPanel('paperlab')` 激活

---

## 二、横向洞察（对 PaperLab 设计的修正）

1. **技能生态已进入“军备竞赛”**：K-Dense 47k★ / DeepMind 入场 / 182 技能中文包。PaperLab 单干技能没有出路，**市场 + 桥接器**是正确路线——已验证的 manifest 适配器路线（risk_level + IO schema + depends_on 补全）应尽快落地，把三大技能库变成自己的弹药库。
2. **“证据可追溯工件”正在成为行业共识**（ARA-Labs/Agent-Native-Research-Artifact 686★、open-science 的 traceable artifacts）——PaperLab 的 6-artifact 架构踩在趋势上，且更完整（有 schema 强制 + fail-closed），应在 README 对比表中强调先发优势。
3. **审稿是高观赏性环节**（ChatPaper 19.9k★ 证明需求）：Review Swarm（P2）值得做且应做成多轮循环（review→revise→re-review），参考 ChatPaper 的审稿/回复 prompt 生态。
4. **订阅式选题**（zotero-arxiv-daily 模式）+ DSH task board cron = topic 阶段的无人值守侦查，成本低差异化强。
5. **竞品 open-science 同构度高**（技能+MCP+可追溯工件+桌面端），PaperLab 的护城河在：证据台账 schema 强制、Human Gate、纯 DSH 插件零 fork、fail-closed 测试纪律。

---

## 三、落地排期（并入 PLAN_v2.1 四周线）

| 时点 | 动作 | 产出 |
|---|---|---|
| W1 | K-Dense manifest 适配器（本地已有克隆） | `paperlab skill install k-dense/<name>` 可用 |
| W1 | zotero-mcp 接入 web profile（MCP client） | 文献库对话式检索 |
| W2 | arxiv-daily 式订阅侦查 + task board cron | 每日选题候选卡 |
| W2 | qinyan + DeepMind science-skills 桥接评估 | 桥接可行性笔记 |
| W3 | ChatPaper 式审稿 prompt 融入 Review Swarm | 3 画像 + 中文审稿语料 |
| W4 | venue-templates 收录 ElegantPaper/arxiv-style/rticles | 模板库 ×3 |

---

## 四、检索记录（可复现）

- `gh search repos "claude skills" --sort stars` → awesome-claude-skills 75.7k / claude-skills 26.7k / …
- `gh search repos "AI scientist" --sort stars` → K-Dense 47k / AI-Scientist 14.6k / v2 7.2k / PaperBanana 7.1k / EvoScientist 5k
- MCP search: `scientific agent skills stars:>500` → DeepMind science-skills / InternScience / qinyan / open-science
- MCP search: `zotero stars:>1500` → zotero / arxiv-daily / zotero-mcp / pdf-translate / zotero-gpt
- MCP search: `latex template paper stars:>1000` → ElegantPaper / rticles / arxiv-style
- MCP search: `gpt-researcher OR deep-research agent report stars:>10000` → RD-Agent 等
