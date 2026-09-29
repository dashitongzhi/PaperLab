/** PaperLab workbench dashboard: the paper-writing pipeline at a glance. */
import { createElement as h, Fragment, useEffect, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  GATE_STAGES,
  STAGES,
  type PaperSnapshot,
  type Remote,
  discoverPapers,
  loadPaper,
} from './data.ts'

/** Accent palette (PaperLab green + neutral grays). */
const C = {
  accent: '#1e3a5f',
  accentSoft: '#e3eaf3',
  accentDark: '#16293f',
  ink: '#111827',
  ink2: '#374151',
  ink3: '#6b7280',
  line: '#e5e7eb',
  card: '#ffffff',
  surface: '#f9fafb',
  warn: '#b45309',
  warnBg: '#fef3c7',
  bad: '#991b1b',
  badBg: '#fee2e2',
} as const

const STAGE_LABEL: Record<string, string> = {
  topic: '选题 Topic',
  data: '数据 Data',
  write: '写作 Write',
  audit: '审计 Audit',
  submit: '投稿 Submit',
}

function stageDot(state: 'active' | 'done' | 'todo'): { bg: string; label: string } {
  if (state === 'active') return { bg: C.accent, label: '●' }
  if (state === 'done') return { bg: '#2e5077', label: '✓' }
  return { bg: '#d1d5db', label: '' }
}

function Card({ title, accent, children }: { title: string; accent?: string; children?: React.ReactNode }) {
  return h('div', { style: {
    background: C.card, border: `1px solid ${C.line}`, borderRadius: 12,
    padding: '16px 18px', minWidth: 0,
    boxShadow: '0 1px 2px rgba(16,24,40,.04)',
  } },
  h('div', { style: {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase',
    color: accent ?? C.ink3, marginBottom: 10,
  } }, title),
  children,
  )
}

function Stat({ n, label, tone }: { n: number | string; label: string; tone?: string }) {
  return h('div', { style: { marginRight: 18, display: 'inline-block' } },
    h('div', { style: { fontSize: 22, fontWeight: 700, color: tone ?? C.ink, lineHeight: 1.15 } }, String(n)),
    h('div', { style: { fontSize: 11, color: C.ink3 } }, label),
  )
}

export interface WorkbenchProps {
  /** The client Remote face (carries workspaceFiles). */
  remote: Remote
  /** Resolve the current session id; may be unavailable before the first session. */
  currentSessionId(): SessionId | undefined
  /** Move the conversation view forward (unused in v1; reserved for actions). */
  onOpenSession?(): void
}

/**
 * The PaperLab workbench main panel: pipeline, gates, ledger, citations,
 * audit — everything a paper author needs, driven by the paper directory's
 * integrity artifacts.
 */
export function Workbench({ remote, currentSessionId }: WorkbenchProps) {
  const [papers, setPapers] = useState<PaperSnapshot[] | null>(null)
  const [selected, setSelected] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    const controller = new AbortController()
    const tick = async (): Promise<void> => {
      const sessionId = currentSessionId()
      if (!sessionId) { if (!disposed) { setError('还没有活动会话 —— 打开一个会话后这里会自动出现你的论文工作台'); setPapers(null) } return }
      try {
        const dirs = await discoverPapers(remote, sessionId, controller.signal)
        const snaps: PaperSnapshot[] = []
        for (const dir of dirs) snaps.push(await loadPaper(remote, sessionId, dir, controller.signal))
        if (!disposed) { setPapers(snaps); setError(null) }
      } catch (err) { if (!disposed) setError(err instanceof Error ? err.message : String(err)) }
    }
    void tick()
    const timer = setInterval(() => { void tick() }, 12_000)
    return () => { disposed = true; clearInterval(timer); controller.abort() }
  }, [remote, currentSessionId])

  if (error !== null) {
    return h('div', shell, h('div', { style: banner(C.warnBg, C.warn) }, 'ⓘ ' + error))
  }
  if (papers === null) return h('div', shell, '载入 PaperLab 工作台…')
  if (papers.length === 0) {
    return h('div', shell,
      h('div', { style: banner(C.accentSoft, C.accentDark) },
        '工作区里还没有论文项目。在会话里说「用 PaperLab 开一篇论文」，或运行 paperlab 工具链创建：topic → data → write → audit → submit。'),
    )
  }

  const paper = papers[Math.min(selected, papers.length - 1)]
  if (paper === undefined) return h('div', shell, '未选择论文')
  const gateFor = (s: string): string | null => {
    const gate = paper.gates[s]
    if (!gate) return null
    return gate.invalidated ? '已失效' : gate.decision === 'approved' ? '闸门已批' : `闸门:${gate.decision ?? '待批'}`
  }

  return h(Fragment, null,

    // paper switcher
    papers.length > 1 && h('div', { style: { ...shell, paddingBottom: 0, display: 'flex', gap: 8 } },
      papers.map((p, i) => h('button', {
        key: p.dir,
        onClick: () => setSelected(i),
        style: {
          padding: '4px 10px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
          border: `1px solid ${i === selected ? C.accent : C.line}`,
          background: i === selected ? C.accentSoft : C.card, color: C.ink2, fontWeight: 500,
        },
      }, p.dir)),
    ),

    h('div', { ...shell, paddingTop: papers.length > 1 ? 12 : 24 },

      // header
      h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 } },
        h('h1', { style: { margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px', color: C.ink } },
          paper.meta.venue ? `论文工作台 · ${paper.meta.venue}` : '论文工作台'),
      ),
      h('div', { style: { fontFamily: 'ui-monospace, monospace', fontSize: 12, color: C.ink3, marginBottom: 18 } }, paper.dir),
      paper.meta.researchQuestion && h('div', { style: {
        fontSize: 13, color: C.ink2, background: C.surface, border: `1px solid ${C.line}`,
        borderRadius: 10, padding: '10px 14px', marginBottom: 18,
      } }, '研究问题：', paper.meta.researchQuestion),

      // pipeline strip
      h(Card, { title: '五阶段流水线 · Pipeline' },
        h('div', { style: { display: 'flex', gap: 0, alignItems: 'center' } },
          STAGES.map((s, i) => {
            const isDone = paper.completedStages.includes(s)
            const isActive = paper.stage === s
            const { bg, label } = stageDot(isActive ? 'active' : isDone ? 'done' : 'todo')
            const gate = gateFor(s)
            return h(Fragment, { key: s },
              i > 0 && h('div', { style: { flex: 1, height: 2, background: isDone ? C.accent : C.line, minWidth: 14 } }),
              h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 76 } },
                h('div', { style: {
                  width: 28, height: 28, borderRadius: '50%', background: bg, color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700,
                  boxShadow: isActive ? `0 0 0 4px ${C.accentSoft}` : 'none',
                } }, label || i + 1),
                h('div', { style: { fontSize: 12, fontWeight: isActive ? 700 : 500, color: isActive ? C.accentDark : C.ink2 } }, STAGE_LABEL[s]),
                h('div', { style: {
                  fontSize: 10, padding: '1px 6px', borderRadius: 4,
                  background: gate === '闸门已批' ? C.accentSoft : gate ? C.badBg : C.surface,
                  color: gate === '闸门已批' ? C.accentDark : gate ? C.bad : C.ink3,
                } }, GATE_STAGES.has(s) ? gate ?? '闸门待批' : ' '),
              ),
            )
          }),
        ),
      ),

      // evidence cards
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 12 } },
        h(Card, { title: '证据台账 · Ledger', accent: C.accent },
          h('div', {},
            h(Stat, { n: paper.claims.supported, label: 'supported 已证实', tone: C.accentDark }),
            h(Stat, { n: paper.claims.draft, label: 'draft 草稿', tone: C.warn }),
            h(Stat, { n: paper.claims.gap, label: 'gap 缺证据', tone: paper.claims.gap > 0 ? C.bad : C.ink3 }),
            h('div', { style: { fontSize: 11, color: C.ink3, marginTop: 8 } }, `共 ${paper.claims.total} 条 claim · draft/gap 不得写成定论`),
          ),
        ),
        h(Card, { title: '引用核验 · Citations', accent: C.accent },
          h('div', {},
            h(Stat, { n: paper.citations.verified, label: '已核验', tone: C.accentDark }),
            h(Stat, { n: paper.citations.failed, label: '未通过', tone: paper.citations.failed > 0 ? C.bad : C.ink3 }),
            h(Stat, { n: paper.citations.pending, label: '待核验', tone: C.ink3 }),
            h('div', { style: { fontSize: 11, color: C.ink3, marginTop: 8 } }, `共 ${paper.citations.total} 条 · CrossRef/arXiv/PubMed 反查`),
          ),
        ),
        h(Card, { title: '审计结论 · Audit', accent: paper.audit.verdict === 'BLOCKED' ? C.bad : C.accent },
          h('div', {},
            h('div', { style: {
              display: 'inline-block', padding: '4px 12px', borderRadius: 8, fontSize: 14, fontWeight: 700,
              background: paper.audit.verdict === 'PASS' ? C.accentSoft : paper.audit.verdict === 'BLOCKED' ? C.badBg : C.surface,
              color: paper.audit.verdict === 'PASS' ? C.accentDark : paper.audit.verdict === 'BLOCKED' ? C.bad : C.ink3,
            } }, paper.audit.verdict === 'UNKNOWN' ? '未运行' : paper.audit.verdict),
            paper.audit.blocking > 0 && h('div', { style: { fontSize: 12, color: C.bad, marginTop: 8 } }, `${paper.audit.blocking} 个 blocking 发现等待修复`),
            h('div', { style: { fontSize: 11, color: C.ink3, marginTop: 8 } }, '结构完整性 · 证据卫生 · 占位符扫描'),
          ),
        ),
      ),

      // recent events
      paper.history.length > 0 && h('div', { style: { marginTop: 12 } },
        h(Card, { title: '最近事件 · History' },
          h('div', {}, ...paper.history.slice().reverse().map(e => h('div', { key: e.at + e.message, style: {
            display: 'flex', gap: 10, padding: '5px 0', fontSize: 12,
            borderBottom: `1px solid ${C.surface}`,
          } },
          h('span', { style: { fontFamily: 'ui-monospace, monospace', color: C.ink3, flex: '0 0 auto' } }, new Date(e.at).toLocaleTimeString()),
          h('span', { style: { color: C.ink2 } }, e.message),
          ))),
        ),
      ),
    ),
  )
}

const shell: React.CSSProperties = {
  padding: '24px 32px 48px', maxWidth: 860, margin: '0 auto',
  fontFamily: "'SF Pro Display', 'PingFang SC', ui-sans-serif, system-ui, sans-serif",
  color: C.ink, overflowY: 'auto', height: '100%', boxSizing: 'border-box',
}

function banner(bg: string, fg: string): React.CSSProperties {
  return { background: bg, color: fg, padding: '12px 16px', borderRadius: 10, fontSize: 13, lineHeight: 1.7 }
}
