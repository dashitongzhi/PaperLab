/** PaperLab Skills panel: the installed skill library plus three-mode creation. */
import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'

/** Claude-style palette over the warm paper canvas. */
const C = {
  paper: '#faf7f0',
  card: '#ffffff',
  ink: '#1f2328',
  ink2: '#4d5359',
  ink3: '#838a92',
  line: '#e5e0d5',
  accent: '#d97757',
  accentHover: '#c4633f',
  accentSoft: 'rgba(217,119,87,.10)',
  navy: '#1e3a5f',
  navySoft: '#e3eaf3',
  ok: '#1e7f4f',
  okBg: '#e8f5ee',
  warn: '#b45309',
  warnBg: '#fdf3e3',
  bad: '#b3352b',
  badBg: '#fbeae8',
} as const

const SERIF = "'Source Serif 4', Georgia, 'Songti SC', serif"
const MONO = "'JetBrains Mono', 'SF Mono', Menlo, monospace"

/** Accept only https GitHub repository URLs for clone-install. */
const GITHUB_URL = /^https:\/\/github\.com\//

/** Creation modes offered by the「+ 添加技能」flow. */
type Mode = 'menu' | 'ai' | 'github' | 'manual'

interface SkillEntry {
  name: string
  description: string
  dir: string
}

/** Build the structured SKILL.md draft for AI-mode creation. */
function buildAiDraft(name: string, need: string): string {
  return [
    '# 技能目标',
    '',
    need,
    '',
    '> (草稿，待会话智能体完善——由 Skills 面板 AI 创作模式生成的骨架，',
    '> 请在会话中让智能体补充细节。)',
    '',
    '## 程序',
    '',
    '1. （待补充：此技能的第一步）',
    '2. （待补充：此技能的第二步）',
    '3. （待补充：此技能的第三步）',
    '',
    '## 边界',
    '',
    '- （待补充：此技能不做什么 / 何时不适用）',
    '- 生成内容须遵守 PaperLab 诚信规则：无证据的断言不得写成定论。',
    '',
  ].join('\n')
}

/**
 * The Skills panel: skill library with three-mode creation (AI draft /
 * GitHub install / manual authoring) and per-card SKILL.md inspection.
 */
export function SkillsPanel(): React.ReactElement {
  const [skills, setSkills] = useState<SkillEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('menu')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [need, setNeed] = useState('')
  const [url, setUrl] = useState('')
  const [body, setBody] = useState('')
  const [openSkill, setOpenSkill] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const noticeTimer = useRef<number | undefined>(undefined)

  const flash = useCallback((tone: 'ok' | 'bad', text: string): void => {
    setNotice({ tone, text })
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 6000)
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/paperlab/skills')
      if (!res.ok) throw new Error(`skills API ${res.status}`)
      const payload = await res.json() as { skills?: SkillEntry[] }
      setSkills(payload.skills ?? [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 20_000)
    return () => { window.clearInterval(timer); window.clearTimeout(noticeTimer.current) }
  }, [refresh])

  useEffect(() => {
    if (openSkill === null) { setContent(null); return }
    const controller = new AbortController()
    const load = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/paperlab/skills/content/${encodeURIComponent(openSkill)}`, { signal: controller.signal })
        if (!res.ok) throw new Error(`content API ${res.status}`)
        const payload = await res.json() as { content?: string }
        setContent(payload.content ?? '(无内容)')
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (!(err instanceof DOMException && err.name === 'AbortError')) setContent(`读取失败: ${message}`)
      }
    }
    void load()
    return () => controller.abort()
  }, [openSkill])

  const resetForm = (): void => { setName(''); setDesc(''); setNeed(''); setUrl(''); setBody('') }

  const install = async (payload: Record<string, string>, okText: string): Promise<void> => {
    setBusy(true)
    try {
      const res = await fetch('/api/paperlab/skills/install', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok || result.error !== undefined) throw new Error(result.error ?? `HTTP ${res.status}`)
      flash('ok', okText)
      setMode('menu')
      resetForm()
      await refresh()
    } catch (err) {
      flash('bad', `安装失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const submitAi = (): void => {
    const clean = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '')
    if (!clean || !need.trim()) return
    const description = desc.trim() || need.trim().slice(0, 80)
    void install({ name: clean, description, body: buildAiDraft(clean, need.trim()) }, `技能 ${clean} 已创建（草稿）`)
  }

  const submitGithub = (): void => {
    const raw = url.trim()
    if (!/^https:\/\/github\.com\//.test(raw)) return
    void install({ url: raw }, 'GitHub 技能安装成功')
  }

  const submitManual = (): void => {
    const clean = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '')
    if (!clean || !body.trim()) return
    void install({ name: clean, description: desc.trim() || '手动编写的技能', body }, `技能 ${clean} 已创建`)
  }

  const shell: React.CSSProperties = {
    padding: '28px 32px 56px', maxWidth: 840, margin: '0 auto',
    fontFamily: "-apple-system, 'PingFang SC', 'Segoe UI', sans-serif",
    color: C.ink, overflowY: 'auto', height: '100%', boxSizing: 'border-box',
    background: C.paper,
  }

  const bigButton: React.CSSProperties = {
    width: '100%', padding: '14px 20px', borderRadius: 8,
    border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 600,
    background: C.accent, color: '#fff',
    boxShadow: '0 1px 3px rgba(217,119,87,.35)',
  }

  const input: React.CSSProperties = {
    border: `1px solid ${C.line}`, borderRadius: 8, padding: '9px 12px',
    fontSize: 13, outline: 'none', background: C.card, color: C.ink, width: '100%',
    boxSizing: 'border-box',
  }

  const primaryBtn: React.CSSProperties = {
    padding: '9px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
    background: C.accent, color: '#fff', fontSize: 13, fontWeight: 600,
  }
  const secondaryBtn: React.CSSProperties = {
    padding: '9px 18px', borderRadius: 8, border: `1px solid ${C.line}`,
    cursor: 'pointer', background: C.card, color: C.ink2, fontSize: 13,
  }
  const modeTab = (active: boolean): React.CSSProperties => ({
    padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
    border: `1px solid ${active ? C.accent : C.line}`,
    background: active ? C.accentSoft : C.card,
    color: active ? C.accentHover : C.ink2, fontWeight: active ? 600 : 400,
  })

  const noticeBox = notice === null ? null : h('div', { style: {
    background: notice.tone === 'ok' ? C.okBg : C.badBg,
    color: notice.tone === 'ok' ? C.ok : C.bad,
    padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 14,
  } }, notice.text)

  const modeChoices: Array<{ id: Exclude<Mode, 'menu'>; icon: string; label: string; hint: string }> = [
    { id: 'ai', icon: '✨', label: 'AI 创作技能', hint: '描述需求，生成 SKILL.md 草稿' },
    { id: 'github', icon: '🐙', label: 'GitHub 链接安装', hint: '克隆公开仓库里的技能' },
    { id: 'manual', icon: '✍️', label: '手动编写', hint: '直接书写 name / 描述 / 正文' },
  ]

  const formCard: React.CSSProperties = {
    background: C.card, border: `1px solid ${C.line}`, borderRadius: 12,
    padding: 20, marginBottom: 16,
  }
  const label: React.CSSProperties = { fontSize: 12, color: C.ink2, display: 'grid', gap: 5, marginBottom: 10 }

  if (error !== null && skills === null) {
    return h('div', shell,
      h('div', { style: { background: C.warnBg, color: C.warn, padding: '12px 16px', borderRadius: 10, fontSize: 13 } }, 'ⓘ ' + error),
    )
  }
  if (skills === null) return h('div', shell, '载入技能库…')

  const creating = mode !== 'menu'

  const creationForm = mode === 'menu' ? null : h('div', { style: formCard },
    h('div', { style: { display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' } },
      ...modeChoices.map(choice => h('button', {
        key: choice.id,
        onClick: () => { setMode(choice.id); setNotice(null) },
        style: modeTab(mode === choice.id),
      }, `${choice.icon} ${choice.label}`)),
    ),
    mode === 'ai' && h('div', {},
      h('label', { style: label }, '技能名（小写字母 / 数字 / 连字符）',
        h('input', {
          value: name,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value),
          placeholder: 'gsea-analysis', style: input,
        }),
      ),
      h('label', { style: label }, '一句话描述（可选，留空则截取需求）',
        h('input', {
          value: desc,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDesc(e.target.value),
          placeholder: '这个技能做什么', style: input,
        }),
      ),
      h('label', { style: label }, '需求描述（会嵌入技能目标的草稿）',
        h('textarea', {
          value: need,
          onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setNeed(e.target.value),
          rows: 4, placeholder: '我想让智能体学会……', style: { ...input, resize: 'vertical' },
        }),
      ),
      h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
        h('button', { onClick: () => { setMode('menu'); resetForm() }, style: secondaryBtn }, '取消'),
        h('button', {
          onClick: submitAi, style: primaryBtn,
          disabled: busy || !name.trim() || !need.trim(),
        }, busy ? '创建中…' : '生成草稿并安装'),
      ),
    ),
    mode === 'github' && h('div', {},
      h('label', { style: label }, 'GitHub 仓库链接（https://github.com/…）',
        h('input', {
          value: url,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setUrl(e.target.value),
          placeholder: 'https://github.com/owner/repo', style: input,
        }),
      ),
      h('div', { style: { fontSize: 12, color: C.ink3, marginBottom: 12 } },
        '浅克隆仓库根目录作为技能目录，需包含 SKILL.md 才会出现在列表。'),
      h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
        h('button', { onClick: () => { setMode('menu'); resetForm() }, style: secondaryBtn }, '取消'),
        h('button', {
          onClick: submitGithub, style: primaryBtn,
          disabled: busy || !GITHUB_URL.test(url.trim()),
        }, busy ? '克隆中…' : '安装'),
      ),
    ),
    mode === 'manual' && h('div', {},
      h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 } },
        h('label', { style: label }, '技能名',
          h('input', {
            value: name,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value),
            placeholder: 'my-skill', style: input,
          }),
        ),
        h('label', { style: label }, '一句话描述',
          h('input', {
            value: desc,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDesc(e.target.value),
            placeholder: '这个技能解决什么问题', style: input,
          }),
        ),
      ),
      h('label', { style: label }, 'SKILL.md 正文（Markdown，frontmatter 由系统生成）',
        h('textarea', {
          value: body,
          onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setBody(e.target.value),
          rows: 8, placeholder: '# 技能目标\n…',
          style: { ...input, fontFamily: MONO, fontSize: 12, resize: 'vertical' },
        }),
      ),
      h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
        h('button', { onClick: () => { setMode('menu'); resetForm() }, style: secondaryBtn }, '取消'),
        h('button', {
          onClick: submitManual, style: primaryBtn,
          disabled: busy || !name.trim() || !body.trim(),
        }, busy ? '创建中…' : '创建技能'),
      ),
    ),
  )

  const skillCard = (skill: SkillEntry): React.ReactElement => {
    const isOpen = openSkill === skill.dir
    return h('div', { key: skill.dir, style: {
      background: C.card, border: `1px solid ${isOpen ? C.accent : C.line}`, borderRadius: 12,
      padding: '14px 16px', boxShadow: '0 1px 2px rgba(31,35,40,.04)',
    } },
    h('div', { style: { display: 'flex', gap: 12, alignItems: 'flex-start' } },
      h('div', { style: {
        width: 34, height: 34, borderRadius: 8, flex: '0 0 auto',
        background: C.navySoft, color: C.navy,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 15, fontWeight: 800,
      } }, skill.name.slice(0, 1).toUpperCase()),
      h('div', { style: { minWidth: 0, flex: 1 } },
        h('div', { style: { fontFamily: SERIF, fontSize: 15, fontWeight: 700, color: C.ink, letterSpacing: '-0.01em' } }, skill.name),
        skill.description && h('div', {
          style: {
            fontSize: 12, color: C.ink3, marginTop: 3, lineHeight: 1.55,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          },
        }, skill.description),
      ),
      h('button', {
        onClick: () => { setOpenSkill(isOpen ? null : skill.dir) },
        style: {
          border: `1px solid ${isOpen ? C.accent : C.line}`, background: isOpen ? C.accentSoft : C.card,
          color: isOpen ? C.accentHover : C.ink2, cursor: 'pointer', fontSize: 12,
          padding: '5px 12px', borderRadius: 8, flex: '0 0 auto',
        },
      }, isOpen ? '收起' : '查看'),
    ),
    isOpen && h('pre', { style: {
      marginTop: 12, padding: '12px 14px', background: C.paper, border: `1px solid ${C.line}`,
      borderRadius: 8, fontFamily: MONO, fontSize: 11.5, lineHeight: 1.6,
      color: C.ink2, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      maxHeight: 320, overflowY: 'auto', margin: '12px 0 0',
    } }, content ?? '读取中…'),
    )
  }

  return h('div', shell,

    h('div', { style: { marginBottom: 18 } },
      h('h1', {
        style: {
          margin: 0, fontSize: 22, fontWeight: 700, fontFamily: SERIF,
          letterSpacing: '-0.015em', color: C.ink,
        },
      }, '技能库 Skills'),
      h('div', { style: { fontSize: 12, color: C.ink3, marginTop: 4 } },
        '论文流水线由技能驱动 —— 每个技能是一段可复用的工作流'),
    ),

    noticeBox,

    !creating && h('button', {
      onClick: () => { setMode('ai'); setNotice(null) },
      style: { ...bigButton, marginBottom: 18 },
    }, '+ 添加技能'),

    creating && creationForm,

    h('div', {
      style: { fontSize: 11, fontWeight: 700, letterSpacing: '0.8px', color: C.ink3, margin: '4px 0 8px' },
    }, `已安装 · ${skills.length}`),
    skills.length === 0
      ? h('div', {
        style: {
          background: C.card, border: `1px dashed ${C.line}`, borderRadius: 12,
          padding: '26px', textAlign: 'center', fontSize: 12, color: C.ink3,
        },
      },
        '技能库为空。点上方「+ 添加技能」，选择 AI 创作 / GitHub 安装 / 手动编写。')
      : h('div', { style: { display: 'grid', gap: 8 } }, ...skills.map(skillCard)),
  )
}
