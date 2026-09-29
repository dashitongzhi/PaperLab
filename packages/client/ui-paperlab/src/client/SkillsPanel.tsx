/** PaperLab Skills panel: the installed skill library plus skill creation. */
import { createElement as h, useEffect, useState } from 'react'
import type { SkillSummary } from './data.ts'
import { skillCreatePrompt, skillDeletePrompt } from './data.ts'

/** Accent palette (PaperLab navy brand). */
const C = {
  navy: '#1e3a5f',
  navyDeep: '#16293f',
  navySoft: '#e3eaf3',
  paper: '#f5f2e9',
  ink: '#111827',
  ink2: '#374151',
  ink3: '#6b7280',
  line: '#e5e7eb',
  card: '#ffffff',
  surface: '#f9fafb',
  warn: '#b45309',
  warnBg: '#fef3c7',
  ok: '#2e5077',
} as const

/** Stage badge copy for the built-in pipeline skills. */
const STAGE_LABEL: Record<string, string> = {
  topic: '阶段 1 · 选题',
  data: '阶段 2 · 数据',
  write: '阶段 3 · 写作',
  audit: '阶段 4 · 审计',
  submit: '阶段 5 · 投稿',
}

/** Map a Chinese/English label to the composer send action if available. */
export interface SkillsPanelProps {
  /** Send one prompt into the active session (wired by the plugin when available). */
  sendPrompt?(prompt: string): void
}

/** Built-in pipeline skills → stage badge. */
const BUILTIN_STAGES: Record<string, string> = {
  'paper-plan': 'topic', 'topic-scan': 'topic',
  'data-forge': 'data',
  'paper-write': 'write', 'claim-ledger': 'write',
  'paper-audit': 'audit', 'qa-check': 'audit',
  'paper-submit': 'submit',
}

/**
 * The Skills panel: the skill library is the product surface — installed
 * pipeline skills at top, user-created skills below, and a creation form
 * that materializes new skills into the workspace.
 */
export function SkillsPanel({ sendPrompt }: SkillsPanelProps) {
  const [skills, setSkills] = useState<SkillSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [body, setBody] = useState('')
  const [preview, setPreview] = useState<{ name: string; body: string } | null>(null)

  useEffect(() => {
    let disposed = false
    const controller = new AbortController()
    const tick = async (): Promise<void> => {
      try {
        // Platform API — session-independent, like a plugin manager.
        const res = await fetch('/api/paperlab/skills', { signal: controller.signal })
        if (!res.ok) throw new Error(`skills API ${res.status}`)
        const body = await res.json() as { skills?: Array<{ name: string; description: string; dir: string }> }
        const list: SkillSummary[] = (body.skills ?? []).map(entry => ({
          name: entry.name,
          description: entry.description,
          dir: entry.dir,
          ...(BUILTIN_STAGES[entry.dir] !== undefined ? { stage: BUILTIN_STAGES[entry.dir] } : {}),
        }))
        if (!disposed) { setSkills(list); setError(null) }
      } catch (err) {
        if (!disposed && !(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }
    }
    void tick()
    const timer = setInterval(() => { void tick() }, 20_000)
    return () => { disposed = true; clearInterval(timer); controller.abort() }
  }, [])

  const shell: React.CSSProperties = {
    padding: '24px 32px 48px', maxWidth: 860, margin: '0 auto',
    fontFamily: "'SF Pro Display', 'PingFang SC', ui-sans-serif, system-ui, sans-serif",
    color: C.ink, overflowY: 'auto', height: '100%', boxSizing: 'border-box',
  }

  const submitCreation = (): void => {
    const clean = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
    if (!clean || !desc.trim()) return
    const prompt = skillCreatePrompt(clean, desc.trim(), body.trim() || '(在此补充该技能的工作流程)')
    if (sendPrompt) { sendPrompt(prompt); setCreating(false); setName(''); setDesc(''); setBody('') }
    else setPreview({ name: clean, body: prompt })
  }

  const requestDelete = (skill: SkillSummary): void => {
    const prompt = skillDeletePrompt(skill.dir)
    if (sendPrompt) sendPrompt(prompt)
    else setPreview({ name: `删除 ${skill.name}`, body: prompt })
  }

  if (error !== null) {
    return h('div', shell,
      h('div', { style: { background: C.warnBg, color: C.warn, padding: '12px 16px', borderRadius: 10, fontSize: 13 } }, 'ⓘ ' + error),
    )
  }
  if (skills === null) return h('div', shell, '载入技能库…')

  const builtins = skills.filter(s => s.stage !== undefined)
  const customs = skills.filter(s => s.stage === undefined)

  const skillCard = (skill: SkillSummary): React.ReactElement =>
    h('div', { key: skill.dir, style: {
      background: C.card, border: `1px solid ${C.line}`, borderRadius: 12,
      padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'flex-start',
      boxShadow: '0 1px 2px rgba(16,24,40,.04)',
    } },
    h('div', { style: {
      width: 34, height: 34, borderRadius: 8, flex: '0 0 auto',
      background: skill.stage ? C.navy : C.paper, color: skill.stage ? '#fff' : C.navy,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 15, fontWeight: 800,
    } }, skill.name.slice(0, 1).toUpperCase()),
    h('div', { style: { minWidth: 0, flex: 1 } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
        h('span', { style: { fontSize: 14, fontWeight: 700, color: C.ink } }, skill.name),
        skill.stage && h('span', { style: {
          fontSize: 10, padding: '2px 8px', borderRadius: 5,
          background: C.navySoft, color: C.navy, fontWeight: 600,
        } }, STAGE_LABEL[skill.stage]),
      ),
      skill.description && h('div', { style: { fontSize: 12, color: C.ink3, marginTop: 4, lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } }, skill.description),
    ),
    h('button', {
      title: '删除该技能',
      onClick: () => requestDelete(skill),
      style: { border: 'none', background: 'transparent', color: C.ink3, cursor: 'pointer', fontSize: 14, padding: 4 },
    }, '✕'),
    )

  return h('div', shell,

    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 } },
      h('div', {},
        h('h1', { style: { margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px', color: C.ink } }, '技能库 Skills'),
        h('div', { style: { fontSize: 12, color: C.ink3, marginTop: 2 } }, '论文流水线由技能驱动 —— 每个技能是一段可复用的工作流'),
      ),
      h('button', {
        onClick: () => setCreating(v => !v),
        style: {
          padding: '8px 14px', borderRadius: 9, border: 'none', cursor: 'pointer',
          background: C.navy, color: '#fff', fontSize: 13, fontWeight: 600,
          boxShadow: '0 1px 3px rgba(22,41,63,.25)',
        },
      }, creating ? '收起' : '+ 新建技能'),
    ),

    creating && h('div', { style: {
      background: C.card, border: `1px solid ${C.line}`, borderRadius: 12,
      padding: 18, marginBottom: 16, display: 'grid', gap: 10,
    } },
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 } },
      h('label', { style: { fontSize: 12, color: C.ink2, display: 'grid', gap: 4 } },
        '名称（小写字母/数字/连字符）',
        h('input', { value: name, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value), placeholder: 'my-skill', style: inputStyle }),
      ),
      h('label', { style: { fontSize: 12, color: C.ink2, display: 'grid', gap: 4 } },
        '一句话描述',
        h('input', { value: desc, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDesc(e.target.value), placeholder: '这个技能解决什么问题、怎么工作', style: inputStyle }),
      ),
    ),
    h('label', { style: { fontSize: 12, color: C.ink2, display: 'grid', gap: 4 } },
      '工作流正文（Markdown）',
      h('textarea', { value: body, onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setBody(e.target.value), rows: 6, placeholder: '## Workflow\n1. …\n2. …', style: { ...inputStyle, fontFamily: 'ui-monospace, monospace', resize: 'vertical' } }),
    ),
    h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
      h('button', { onClick: () => setCreating(false), style: secondaryBtn }, '取消'),
      h('button', { onClick: submitCreation, style: primaryBtn, disabled: !name.trim() || !desc.trim() }, '创建技能'),
    ),
    ),

    preview && h('div', { style: { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14, marginBottom: 16 } },
      h('div', { style: { fontSize: 12, color: C.ink2, marginBottom: 8 } }, '复制下面这段话到会话输入框，技能即被创建：'),
      h('pre', { style: { whiteSpace: 'pre-wrap', fontSize: 11, color: C.ink3, maxHeight: 180, overflowY: 'auto', margin: 0 } }, preview.body),
      h('button', { onClick: () => setPreview(null), style: { ...secondaryBtn, marginTop: 8 } }, '知道了'),
    ),

    builtins.length > 0 && h('div', { style: { fontSize: 11, fontWeight: 700, letterSpacing: '0.8px', color: C.ink3, margin: '6px 0 8px' } }, '流水线技能 · PIPELINE'),
    h('div', { style: { display: 'grid', gap: 8 } }, ...builtins.map(skillCard)),

    h('div', { style: { fontSize: 11, fontWeight: 700, letterSpacing: '0.8px', color: C.ink3, margin: '18px 0 8px' } }, '我的技能 · MY SKILLS'),
    customs.length === 0
      ? h('div', { style: { background: C.surface, border: `1px dashed ${C.line}`, borderRadius: 12, padding: '22px', textAlign: 'center', fontSize: 12, color: C.ink3 } },
        '还没有自建技能。点右上角「+ 新建技能」，描述你想自动化的科研流程。')
      : h('div', { style: { display: 'grid', gap: 8 } }, ...customs.map(skillCard)),
  )
}

const inputStyle: React.CSSProperties = {
  border: `1px solid ${C.line}`, borderRadius: 8, padding: '8px 10px',
  fontSize: 13, outline: 'none', background: C.card, color: C.ink,
}
const primaryBtn: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 9, border: 'none', cursor: 'pointer',
  background: C.navy, color: '#fff', fontSize: 13, fontWeight: 600,
}
const secondaryBtn: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 9, border: `1px solid ${C.line}`,
  cursor: 'pointer', background: C.card, color: C.ink2, fontSize: 13,
}
