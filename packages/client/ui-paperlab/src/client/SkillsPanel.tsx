/** PaperLab Skills center: the skill library rendered in the plugin-manager
 *  page system (head + refresh, group card lists, detail page, install dialog
 *  with folded log, toast) over PaperLab's own data and naming. */
import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import {
  IconCheckCircleFillRegular,
  IconChevronDownOutlineRegular,
  IconChevronLeftOutlineMedium,
  IconRefreshOutlineRegular,
  IconWarningOutlineRegular,
  Modal,
  Toast,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import css from './SkillsPanel.module.css'

/** Accept only https GitHub repository URLs for clone-install. */
const GITHUB_URL = /^https:\/\/github\.com\//

/** Creation modes offered by the「+ 添加技能」dialog. */
type Mode = 'ai' | 'github' | 'manual'

/** Which surface of the page is on screen. */
type View = { kind: 'list' } | { kind: 'detail'; dir: string }

interface SkillEntry {
  name: string
  description: string
  dir: string
}

/** The eight skills the product ships, shown as the「内置技能」group. */
const BUILT_IN = new Set([
  'paper-plan', 'topic-scan', 'data-forge', 'paper-write',
  'claim-ledger', 'paper-audit', 'qa-check', 'paper-submit',
])

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

/** How long a toast holds, scaled to the text it carries. */
function toastHoldMs(text: string): number {
  return Math.min(8_000, Math.max(3_000, text.length * 80))
}

export function SkillsPanel(): React.ReactElement {
  const [skills, setSkills] = useState<SkillEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [view, setView] = useState<View>({ kind: 'list' })
  const [dialogOpen, setDialogOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('ai')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ seq: number; bad: boolean; text: string } | null>(null)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [need, setNeed] = useState('')
  const [url, setUrl] = useState('')
  const [body, setBody] = useState('')
  const [logOpen, setLogOpen] = useState(false)
  const [logText, setLogText] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const toastSeq = useRef(0)

  const flash = useCallback((bad: boolean, text: string): void => {
    toastSeq.current += 1
    setToast({ seq: toastSeq.current, bad, text })
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/paperlab/skills')
      if (!res.ok) throw new Error(`skills API ${res.status}`)
      const payload = await res.json() as { skills?: SkillEntry[] }
      setSkills(payload.skills ?? [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 20_000)
    return () => { window.clearInterval(timer) }
  }, [refresh])

  useEffect(() => {
    if (view.kind !== 'detail') { setContent(null); return }
    const controller = new AbortController()
    const load = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/paperlab/skills/content/${encodeURIComponent(view.dir)}`, { signal: controller.signal })
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
  }, [view])

  useEffect(() => {
    if (toast === null) return
    const timer = window.setTimeout(() => setToast(null), toastHoldMs(toast.text))
    return () => { window.clearTimeout(timer) }
  }, [toast])

  const resetForm = (): void => { setName(''); setDesc(''); setNeed(''); setUrl(''); setBody(''); setLogText(null); setLogOpen(false) }

  const closeDialog = (): void => { setDialogOpen(false); resetForm() }

  const install = async (payload: Record<string, string>, okText: string): Promise<void> => {
    setBusy(true)
    try {
      const res = await fetch('/api/paperlab/skills/install', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await res.json() as { ok?: boolean; error?: string; name?: string }
      if (!res.ok || result.error !== undefined) throw new Error(result.error ?? `HTTP ${res.status}`)
      flash(false, okText)
      closeDialog()
      await refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setLogText(message)
      setLogOpen(true)
      flash(true, `安装失败：${message}`)
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
    if (!GITHUB_URL.test(raw)) return
    void install({ url: raw }, 'GitHub 技能安装成功')
  }

  const submitManual = (): void => {
    const clean = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '')
    if (!clean || !body.trim()) return
    void install({ name: clean, description: desc.trim() || '手动编写的技能', body }, `技能 ${clean} 已创建`)
  }

  const open = view.kind === 'detail' ? skills?.find(skill => skill.dir === view.dir) : undefined

  if (error !== null && skills === null) {
    return h('div', { className: css.page },
      h('div', { className: css.empty }, `ⓘ ${error}`),
    )
  }
  if (skills === null) return h('div', { className: css.page }, '载入技能库…')

  const builtIn = skills.filter(skill => BUILT_IN.has(skill.name))
  const installed = skills.filter(skill => !BUILT_IN.has(skill.name))
  const groups: Array<{ title: string; entries: SkillEntry[] }> = [
    { title: '内置技能', entries: builtIn },
    { title: '已安装', entries: installed },
  ].filter(group => group.entries.length > 0)

  const modeTabs: Array<{ id: Mode; label: string }> = [
    { id: 'ai', label: '✨ AI 起草' },
    { id: 'github', label: '🐙 GitHub' },
    { id: 'manual', label: '✍️ 手动' },
  ]

  const detail = view.kind === 'detail'
    ? h('div', { className: css.page, key: 'detail' },
      h('div', { className: css.detailTop },
        h('button', {
          className: css.crumb,
          onClick: () => { setView({ kind: 'list' }) },
        },
          h('span', { className: css.crumbIcon }, h(IconChevronLeftOutlineMedium, { size: 14 })),
          '技能库',
        ),
      ),
      open === undefined
        ? h('div', { className: css.empty, style: { marginTop: 24 } }, '技能不存在或已被移除。')
        : h('div', {},
          h('div', { className: css.detailHead },
            h('div', { className: css.detailIcon }, open.name.slice(0, 1).toUpperCase()),
          ),
          h('div', { className: css.detailMain },
            h('h1', { className: css.detailTitle }, open.name),
            open.description && h('p', { className: css.detailDesc }, open.description),
            h('p', { className: css.detailMeta }, '目录 ', h('code', null, open.dir)),
          ),
          h('pre', { className: css.skillSource }, content ?? '读取 SKILL.md…'),
        ),
    )
    : null

  const list = view.kind === 'list'
    ? h('div', { className: css.page, key: 'list' },
      h('div', { className: css.pageHead },
        h('div', {},
          h('h1', { className: css.pageTitle }, '技能库'),
          h('p', { className: css.pageIntro }, '安装、启用和创作论文技能。技能驱动五阶段论文流水线。'),
        ),
        h('div', { className: css.headActions },
          h(Tooltip, { label: '刷新技能列表', side: 'bottom' },
            h('button', {
              className: refreshing ? `${css.iconButton} ${css.spin}` : css.iconButton,
              'aria-label': '刷新技能列表',
              onClick: () => { void refresh() },
              disabled: refreshing,
            }, h(IconRefreshOutlineRegular, { size: 15 })),
          ),
        ),
      ),

      h('button', {
        className: css.addButton,
        onClick: () => { setDialogOpen(true) },
      }, '+ 添加技能'),

      ...(error !== null
        ? [h('div', { className: css.empty, key: 'load-error' }, `ⓘ ${error}`)]
        : []),

      ...groups.map(group => h('div', { className: css.group, key: group.title },
        h('div', { className: css.groupHead },
          h('h2', { className: css.groupTitle }, group.title),
          h('span', { className: css.count }, String(group.entries.length)),
        ),
        group.entries.length === 0
          ? h('p', { className: css.empty }, '这一组还没有技能。用上方「+ 添加技能」安装或创作。')
          : h('ul', { className: css.cards },
            ...group.entries.map(skill => h('li', { className: css.card, key: skill.dir },
              h('div', { className: css.cardHead },
                h('div', { className: css.cardIcon }, skill.name.slice(0, 1).toUpperCase()),
                h('div', { className: css.cardMain },
                  h('div', { className: css.cardLink },
                    h('button', {
                      className: css.cardOpen,
                      onClick: () => { setView({ kind: 'detail', dir: skill.dir }) },
                    }, skill.name),
                  ),
                  h('div', { className: css.cardDesc },
                    skill.description || '（无描述——安装包含 SKILL.md 的仓库后会自动读取）'),
                ),
                h('button', {
                  className: css.viewChip,
                  onClick: () => { setView({ kind: 'detail', dir: skill.dir }) },
                }, '查看'),
              ),
            )),
          ),
      )),

      groups.length === 0 && h('p', { className: css.empty },
        '技能库为空。点上方「+ 添加技能」，选择 AI 起草 / GitHub 安装 / 手动编写。'),
    )
    : null

  const dialog = h(Modal, {
    open: dialogOpen,
    onClose: closeDialog,
    title: '添加技能',
    className: css.installDialog,
  },
    h('div', { className: css.installContent },
      h('div', { className: css.installBody },
        h('div', { className: css.modeTabs },
          ...modeTabs.map(tab => h('button', {
            key: tab.id,
            className: css.modeTab,
            'data-active': mode === tab.id,
            onClick: () => { setMode(tab.id) },
          }, tab.label)),
        ),
        mode === 'ai' && h('div', { className: css.installBody },
          h('label', { className: css.field }, '技能名（小写字母 / 数字 / 连字符）',
            h('input', {
              value: name,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value),
              placeholder: 'gsea-analysis',
            }),
          ),
          h('label', { className: css.field }, '一句话描述（可选，留空则截取需求）',
            h('input', {
              value: desc,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDesc(e.target.value),
              placeholder: '这个技能做什么',
            }),
          ),
          h('label', { className: css.field }, '需求描述（会嵌入技能目标的草稿）',
            h('textarea', {
              value: need,
              onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setNeed(e.target.value),
              rows: 4,
              placeholder: '我想让智能体学会……',
            }),
          ),
        ),
        mode === 'github' && h('div', { className: css.installBody },
          h('label', { className: css.field }, 'GitHub 仓库链接（https://github.com/…）',
            h('input', {
              value: url,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setUrl(e.target.value),
              placeholder: 'https://github.com/owner/repo',
            }),
          ),
          h('p', { className: css.hint }, '浅克隆仓库根目录作为技能目录，需包含 SKILL.md 才会出现在列表。'),
          logText !== null && h('div', { className: css.logFold },
            h('button', {
              className: css.logFoldHead,
              onClick: () => { setLogOpen(!logOpen) },
            },
              h('span', { className: css.logFoldIcon, 'data-open': logOpen },
                h(IconChevronDownOutlineRegular, { size: 13 })),
              '安装日志',
            ),
            logOpen && h('pre', { className: css.logBody }, logText),
          ),
        ),
        mode === 'manual' && h('div', { className: css.installBody },
          h('label', { className: css.field }, '技能名',
            h('input', {
              value: name,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value),
              placeholder: 'my-skill',
            }),
          ),
          h('label', { className: css.field }, '一句话描述',
            h('input', {
              value: desc,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDesc(e.target.value),
              placeholder: '这个技能解决什么问题',
            }),
          ),
          h('label', { className: css.field }, 'SKILL.md 正文（Markdown，frontmatter 由系统生成）',
            h('textarea', {
              value: body,
              onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setBody(e.target.value),
              rows: 8,
              placeholder: '# 技能目标\n…',
            }),
          ),
        ),
      ),
    ),
    h('div', { className: css.installFooter },
      h('button', { className: css.secondaryAction, onClick: closeDialog }, '取消'),
      mode === 'ai' && h('button', {
        className: css.primaryAction,
        onClick: submitAi,
        disabled: busy || !name.trim() || !need.trim(),
      }, busy ? '创建中…' : '生成草稿并安装'),
      mode === 'github' && h('button', {
        className: css.primaryAction,
        onClick: submitGithub,
        disabled: busy || !GITHUB_URL.test(url.trim()),
      }, busy ? '克隆中…' : '安装'),
      mode === 'manual' && h('button', {
        className: css.primaryAction,
        onClick: submitManual,
        disabled: busy || !name.trim() || !body.trim(),
      }, busy ? '创建中…' : '创建技能'),
    ),
  )

  return h('div', {},
    detail ?? list,
    dialog,
    toast !== null && h(Toast, {
      key: toast.seq,
      text: toast.text,
      icon: toast.bad ? h(IconWarningOutlineRegular, {}) : h(IconCheckCircleFillRegular, {}),
      onDone: () => { setToast(null) },
    }),
  )
}
