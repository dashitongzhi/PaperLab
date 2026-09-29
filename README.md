# PaperLab

English | [中文](#paperlab中文)

**Evidence-first paper-writing agent — from your data to a referee-ready PDF, with the receipts.**

```
data import → topic scan → manuscript writing → LaTeX compile → integrity audit → submission gate
```

PaperLab is an independent product built on the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
runtime (MIT). Every conclusion in the manuscript must be bound to an evidence
artifact; every citation is verified against CrossRef/arXiv before it enters the
bibliography; every compile produces a structured build report; and a fail-closed
audit gate (PASS/BLOCKED with fix suggestions) guards the submit stage.

## The three product lines

| Line | Capability | Tools (`packages/paperlab/tools/`) |
|---|---|---|
| **A · Manuscript loop** | Isolated tectonic/pdflatex compile, 3 venue templates (MethodsX / JOSS / arXiv), sha256-idempotent rebuilds, structured `build-report.json` | `compile/paperlab-compile.mjs` |
| **B · Integrity gates** | Claim-evidence ledger (Ajv fail-closed), CrossRef→arXiv DOI verification + cite-gap analysis, python audit engine with PASS/BLOCKED verdict + fix suggestions, Node fallback | `ledger/`, `citation-check/`, `paper-audit/` |
| **C · Your data in** | csv/tsv/json/xlsx/parquet import with column-type profiling, missing counts, numeric stats, categorical top-5; sha256 manifests `D###/{manifest,data-card,traceability}.json` | `import/paperlab-import.mjs` |

Plus the **skills plane**: 8 paper skills (`packages/paperlab/skills/`) drive the
agent through the five stages (topic → data → write → audit → submit), and the
Skills panel offers ✨ AI-drafted, 🐙 GitHub-URL, and ✍️ manual skill creation.

## End-to-end validation (2026-09-29)

Fresh paper directory → imported two real datasets (12×5001 count matrix +
5000×4 ground truth, manifests D001/D002) → manuscript body written by the
model **grounded in the imported manifests** → compiled to a 2-page PDF with
**0 errors / 0 warnings** (tectonic) → citations verified via CrossRef →
audit verdict **PASS** (engine: paper_audit.py). Injected defects were
correctly **BLOCKED** at each gate along the way.

## Quick start

```sh
git clone https://github.com/dashitongzhi/PaperLab.git
cd PaperLab && pnpm install && pnpm build:web
MINIMAX_API_KEY=… DSH_HOME=~/.paperlab-app node apps/cli/lib/bin.js --profile web --port 3306
```

Any Anthropic-compatible endpoint works (configure a provider in the profile's
`cordis.patch.yml` under `dsh-llm-pi-ai`; keys are read from environment
variables and never stored in the repository).

## License

MIT (inherits the upstream DeepSeek Harness license). Self-hosted fonts:
Source Serif 4 and JetBrains Mono under OFL 1.1 (`packages/client/ui-theme/src/styles/fonts/`).

---

# PaperLab（中文）

**证据优先的论文写作智能体 —— 从你的数据到可送审的 PDF，每一步都有据可查。**

```
数据导入 → 选题侦查 → 正文写作 → LaTeX 编译 → 诚信审计 → 投稿闸门
```

PaperLab 是基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT）构建的独立产品。
稿件中的每个结论必须绑定证据工件；每条引用进入参考文献前先经 CrossRef/arXiv 核验；
每次编译产出结构化构建报告；fail-closed 审计闸门（PASS/BLOCKED + 修复建议）守卫投稿阶段。

## 三条主线

| 主线 | 能力 | 工具（`packages/paperlab/tools/`） |
|---|---|---|
| **A · 成稿闭环** | 隔离编译（tectonic 优先 / pdflatex 回退）、3 套 venue 模板、sha256 幂等重编、结构化 `build-report.json` | `compile/paperlab-compile.mjs` |
| **B · 质量硬门禁** | 论点-证据台账（Ajv fail-closed）、CrossRef→arXiv DOI 核验 + 引用缺口分析、Python 审计引擎（PASS/BLOCKED + 修复建议）、Node 降级 | `ledger/`、`citation-check/`、`paper-audit/` |
| **C · 数据导入** | csv/tsv/json/xlsx/parquet 多格式导入 + 列类型画像（缺失/数值统计/分类 top-5）、sha256 清单 `D###/{manifest,data-card,traceability}.json` | `import/paperlab-import.mjs` |

另有**技能平面**：8 个论文技能（`packages/paperlab/skills/`）驱动智能体走完五阶段
（topic → data → write → audit → submit）；Skills 面板支持 ✨ AI 起草、🐙 GitHub 链接、✍️ 手动编写三种添加方式。

## 端到端验证（2026-09-29）

新建论文目录 → 导入两个真实数据集（12×5001 计数矩阵 + 5000×4 真值表，清单 D001/D002）→
模型**基于导入清单**撰写正文 → tectonic 编译出 **2 页 PDF，0 错误 0 警告** → CrossRef 引用核验 →
审计结论 **PASS**（引擎 paper_audit.py）。过程中注入的缺陷在各个闸门被正确 **BLOCKED**。

## 快速开始

```sh
git clone https://github.com/dashitongzhi/PaperLab.git
cd PaperLab && pnpm install && pnpm build:web
MINIMAX_API_KEY=… DSH_HOME=~/.paperlab-app node apps/cli/lib/bin.js --profile web --port 3306
```

任意 Anthropic 兼容端点均可接入（在 profile 的 `cordis.patch.yml` 里 `dsh-llm-pi-ai` 下配置供应商；
密钥只从环境变量读取，绝不入库）。

## 许可

MIT（继承上游 DeepSeek Harness 许可）。自托管字体：Source Serif 4 与 JetBrains Mono（OFL 1.1，
见 `packages/client/ui-theme/src/styles/fonts/`）。
