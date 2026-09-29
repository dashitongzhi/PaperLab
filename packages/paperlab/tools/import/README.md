# paperlab-import

PaperLab **C 线（用户数据导入）** 的 CLI 工具：把用户自己的数据文件导入论文目录，
自动完成格式嗅探、数据画像、完整性工件（manifest / data-card / traceability）落盘，
并可一键把「数据 → 论点」写进 claim-evidence ledger。

## 用法

```sh
node packages/paperlab/tools/import/paperlab-import.mjs \
  --file ~/my/experiment.csv \
  --paper-dir /Users/kral/project/papers/drafts/paper_demo \
  --title "Enrichment consistency counts" \
  --source-type user_provided \
  --claim "DESeq2 MA 图基于该 counts 矩阵生成" \
  --copy
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `--file` | ✅ | 数据文件路径（csv / tsv / json / xlsx / parquet） |
| `--paper-dir` | ✅ | 论文根目录（须已存在），工件落在其 `evidence/` 下 |
| `--title` | ✅ | 数据集标题（写进 manifest） |
| `--source-type` | — | `user_provided`（默认）/ `public_download` / `computed` |
| `--source-url` | — | 来源 URL 或 `local:/abs/path` 指针 |
| `--claim` | — | 关联论点；提供时追加一行到 `evidence/claim_evidence_ledger.csv` |
| `--copy` | — | 拷贝数据文件到 `<paper-dir>/data/`；缺省为原地引用 |

## 格式支持矩阵

| 格式 | 解析方式 | 画像能力 | 依赖 |
|---|---|---|---|
| csv / tsv | Node 原生流式（RFC 4180 引号处理，前 10MB） | 行列数、列类型（numeric/categorical/datetime/text）、缺失计数、数值 min/max/mean、分类 top-5 | 无 |
| json | 数组-of-对象（或 `{data:[...]}` 包装） | 同上 | 无 |
| xlsx | `python3 -c` 调 openpyxl 转 JSON 后解析 | 同上 | python3 + openpyxl（缺失时明确报错并提示 `pip3 install openpyxl`） |
| parquet | `PAR1` 魔数识别；python3 + pyarrow 可选读元信息 | 行数/列名/列类型（pyarrow 缺失时仅记录文件与 sha256） | python3 + pyarrow（可选） |

类型推断基于前 1000 行采样：全数值 → `numeric`；日期时间形态 → `datetime`；
低基数（≤20% 唯一值且 ≤25 个）或布尔 → `categorical`；其余 → `text`。

## 落盘结构（对齐旧插件 `paperlab_dataset_manifest` 约定）

```
<paper-dir>/
├── data/<basename>                          # 仅 --copy 时
└── evidence/
    ├── claim_evidence_ledger.csv            # --claim 时追加
    └── datasets/D###/
        ├── manifest.json                    # id/title/source/sha256/rows/cols/created_at
        ├── data-card.json                   # profile: columns[] / row_count / sample_rows(前5行)
        └── traceability.json                # dataset_id / input_sha256 / tool / created_at
```

`D###` 自增规则：扫描 `evidence/datasets/` 下已有 `D\d+` 取最大值 +1。

## 隐私说明

- 文件**永远留在本地**：不做任何网络上传；`--copy` 也只是本地拷贝。
- 原地引用（默认）时 manifest 记录绝对路径 + sha256；拷贝模式记录论文目录内相对路径。
- 上传给模型的只有画像摘要（列名/类型/统计量/前 5 行样例），不包含全量数据。

## 设计约束

- 纯 Node stdlib + python3 子进程，零 npm 依赖。
- 解析与画像**先于**任何写盘 —— 解析失败（空文件、纯表头、坏 JSON）绝不留下半个 manifest。
- 边界行为：空文件 / 纯表头 / 不存在路径 / 未知格式 → 非零退出码 + 明确错误信息。
