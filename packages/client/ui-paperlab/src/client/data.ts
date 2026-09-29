/**
 * PaperLab workbench data plane: resolve the active session's workspace,
 * discover paper directories, and read their integrity artifacts through the
 * public workspaceFiles Remote (list / read).
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Minimal structural typing over the generated Remote faces we consume. */
export interface WorkspaceFilesRemote {
  list(sessionId: SessionId, path: string, signal?: AbortSignal): Promise<ListResult>
  read(sessionId: SessionId, path: string, range?: unknown, signal?: AbortSignal): Promise<ReadResult>
}

export interface ListResult {
  ok: boolean
  value?: { entries: Array<{ name: string; type: string }>; truncated?: boolean }
  error?: { message?: string }
}

export interface ReadResult {
  ok: boolean
  value?: unknown
  error?: { message?: string }
}

/** The client Remote face carrying the workspaceFiles namespace. */
export type Remote = { workspaceFiles?: WorkspaceFilesRemote } & Record<string, unknown>

/** One discovered paper's workbench snapshot. */
export interface PaperSnapshot {
  /** Directory path relative to the workspace root, e.g. `drafts/paper_demo`. */
  readonly dir: string
  readonly stage: string | null
  readonly lastCompletedStage: string | null
  readonly completedStages: readonly string[]
  /** stage -> { decision, invalidated } */
  readonly gates: Readonly<Record<string, { decision?: string; invalidated?: boolean }>>
  readonly updatedAt: string | null
  readonly history: readonly { at: string; message: string }[]
  /** claim counts by evidence status, from claim_evidence_ledger.csv */
  readonly claims: { supported: number; draft: number; gap: number; total: number }
  /** citation verification counts, from citation-verification.jsonl */
  readonly citations: { verified: number; failed: number; pending: number; total: number }
  /** audit verdict from checks/audit_report.md */
  readonly audit: { verdict: 'PASS' | 'BLOCKED' | 'UNKNOWN'; blocking: number }
  /** PAPERLAB.md frontmatter facts (best effort) */
  readonly meta: { researchQuestion?: string; venue?: string }
}

export const STAGES = ['topic', 'data', 'write', 'audit', 'submit'] as const
export type Stage = (typeof STAGES)[number]
export const GATE_STAGES: ReadonlySet<string> = new Set(['topic', 'audit', 'submit'])

/** Decode a remote read result value (text or bytes) to string. */
export function decodeRead(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  const v = value as { text?: unknown; bytes?: unknown }
  if (typeof v.text === 'string') return v.text
  if (v.bytes instanceof Uint8Array) return new TextDecoder().decode(v.bytes)
  try { return JSON.stringify(value) } catch { return '' }
}

/** Parse a CSV's rows into header-aligned records (RFC 4180-lite). */
export function parseCsvRows(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter(line => line.trim() !== '')
  if (lines.length < 2) return []
  const split = (line: string): string[] => {
    const cells: string[] = []
    let current = ''
    let quoted = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (quoted) {
        if (ch === '"') { if (line[i + 1] === '"') { current += '"'; i++ } else quoted = false }
        else current += ch
      } else if (ch === '"') quoted = true
      else if (ch === ',') { cells.push(current); current = '' }
      else current += ch
    }
    cells.push(current)
    return cells
  }
  const header = split(lines[0] ?? '').map(h => h.trim())
  return lines.slice(1).map((line) => {
    const cells = split(line)
    const row: Record<string, string> = {}
    header.forEach((h, i) => { row[h] = (cells[i] ?? '').trim() })
    return row
  })
}

function countClaims(text: string): PaperSnapshot['claims'] {
  const rows = parseCsvRows(text)
  const counts = { supported: 0, draft: 0, gap: 0, total: 0 }
  for (const row of rows) {
    const status = (row.evidence_status ?? '').toLowerCase()
    if (status === '') continue
    counts.total++
    if (status === 'supported') counts.supported++
    else if (status === 'draft') counts.draft++
    else counts.gap++
  }
  return counts
}

function countCitations(text: string): PaperSnapshot['citations'] {
  const counts = { verified: 0, failed: 0, pending: 0, total: 0 }
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue
    try {
      const row = JSON.parse(line) as { status?: string }
      const status = (row.status ?? '').toLowerCase()
      counts.total++
      if (status === 'verified' || status === 'ok' || status === 'matched') counts.verified++
      else if (status === 'failed' || status === 'mismatch' || status === 'unverified') counts.failed++
      else counts.pending++
    } catch { /* skip malformed line */ }
  }
  return counts
}

function readAudit(text: string): PaperSnapshot['audit'] {
  const verdict = /verdict\s*[:=]\s*(PASS|BLOCKED)/i.exec(text)
  const blocking = [...text.matchAll(/BLOCK(?:ED|ING)/gi)].length
  return {
    verdict: verdict && verdict[1] ? (verdict[1].toUpperCase() as 'PASS' | 'BLOCKED') : (/PASS/i.test(text) ? 'PASS' : /BLOCKED/i.test(text) ? 'BLOCKED' : 'UNKNOWN'),
    blocking: /BLOCKED/i.test(text) ? Math.max(blocking, 1) : 0,
  }
}

function readMeta(text: string): PaperSnapshot['meta'] {
  const meta: PaperSnapshot['meta'] = {}
  const rq = /research_question\s*[:=]\s*(.+)/i.exec(text)
  if (rq && rq[1]) meta.researchQuestion = rq[1].trim().slice(0, 120)
  const venue = /target_venue\s*[:=]\s*(.+)/i.exec(text)
  if (venue && venue[1]) meta.venue = venue[1].trim().slice(0, 40)
  return meta
}

/**
 * Discover paper directories in the session workspace: any directory two or
 * fewer levels deep carrying `evidence/workflow-state.json`.
 */
export async function discoverPapers(remote: Remote, sessionId: SessionId, signal?: AbortSignal): Promise<string[]> {
  const wf = remote.workspaceFiles
  if (!wf) return []
  const dirs: string[] = []
  const candidates = ['.', 'drafts', 'papers']
  for (const root of candidates) {
    try {
      const res = await wf.list(sessionId, root, signal)
      if (!res?.ok || !res.value?.entries) continue
      for (const entry of res.value.entries) {
        if (entry.type !== 'directory') continue
        const child = root === '.' ? entry.name : `${root}/${entry.name}`
        if (child.startsWith('.') || child === 'node_modules') continue
        try {
          const probe = await wf.read(sessionId, `${child}/evidence/workflow-state.json`, undefined, signal)
          if (probe?.ok) dirs.push(child)
        } catch { /* not a paper dir */ }
      }
    } catch { /* skip root */ }
    if (dirs.length > 0) break
  }
  return dirs
}

/** Load one paper's full workbench snapshot. */
export async function loadPaper(remote: Remote, sessionId: SessionId, dir: string, signal?: AbortSignal): Promise<PaperSnapshot> {
  const wf = remote.workspaceFiles
  const read = async (path: string): Promise<string> => {
    if (!wf) return ''
    try {
      const res = await wf.read(sessionId, `${dir}/${path}`, undefined, signal)
      return res?.ok ? decodeRead(res.value) : ''
    } catch { return '' }
  }
  const stateText = await read('evidence/workflow-state.json')
  let state: Record<string, unknown> = {}
  try { state = JSON.parse(stateText) as Record<string, unknown> } catch { /* defaults below */ }
  const gates = (state.gates ?? {}) as Record<string, { decision?: string; invalidated?: boolean }>
  const history = Array.isArray(state.history) ? (state.history as { at: string; message: string }[]).slice(-12) : []
  const [ledgerText, citationsText, auditText, metaText] = await Promise.all([
    read('evidence/claim_evidence_ledger.csv'),
    read('evidence/citation-verification.jsonl'),
    read('checks/audit_report.md'),
    read('PAPERLAB.md'),
  ])
  return {
    dir,
    stage: (state.stage as string | null) ?? null,
    lastCompletedStage: (state.last_completed_stage as string | null) ?? null,
    completedStages: (state.completed_stages as string[] | undefined) ?? [],
    gates,
    updatedAt: (state.updated_at as string | null) ?? null,
    history,
    claims: ledgerText ? countClaims(ledgerText) : { supported: 0, draft: 0, gap: 0, total: 0 },
    citations: citationsText ? countCitations(citationsText) : { verified: 0, failed: 0, pending: 0, total: 0 },
    audit: auditText ? readAudit(auditText) : { verdict: 'UNKNOWN', blocking: 0 },
    meta: metaText ? readMeta(metaText) : {},
  }
}

/** Directories scanned for user skills, in order. */
const SKILL_ROOTS = ['.paperlab/skills', 'skills']

/** One installed skill as shown in the panel. */
export interface SkillSummary {
  readonly name: string
  readonly description: string
  /** Directory path relative to the workspace root. */
  readonly dir: string
  /** Pipeline stage this skill belongs to, when it is one of the built-ins. */
  readonly stage?: string
}

/** Parse `name`/`description` from SKILL.md frontmatter. */
export function parseFrontmatter(text: string): { name?: string; description?: string } {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!fm) return {}
  const pick = (key: string): string | undefined => {
    const m = fm[1] ? new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(fm[1]) : undefined
    return m?.[1]?.trim()
  }
  const result: { name?: string; description?: string } = {}
  const n = pick('name'); if (n !== undefined) result.name = n
  const d = pick('description'); if (d !== undefined) result.description = d
  return result
}

const BUILTIN_STAGES: Record<string, string> = {
  'paper-plan': 'topic',
  'topic-scan': 'topic',
  'data-forge': 'data',
  'paper-write': 'write',
  'claim-ledger': 'write',
  'paper-audit': 'audit',
  'qa-check': 'audit',
  'paper-submit': 'submit',
}

/**
 * Discover skills across the known roots of the session workspace.
 */
export async function listSkills(remote: Remote, sessionId: SessionId, signal?: AbortSignal): Promise<SkillSummary[]> {
  const wf = remote.workspaceFiles
  if (!wf) return []
  const found: SkillSummary[] = []
  const seen = new Set<string>()
  for (const root of SKILL_ROOTS) {
    try {
      const res = await wf.list(sessionId, root, signal)
      if (!res?.ok || !res.value?.entries) continue
      for (const entry of res.value.entries) {
        if (entry.type !== 'directory' || seen.has(entry.name)) continue
        try {
          const md = await wf.read(sessionId, `${root}/${entry.name}/SKILL.md`, undefined, signal)
          if (!md?.ok) continue
          const text = decodeRead(md.value)
          const fm = parseFrontmatter(text)
          seen.add(entry.name)
          const stage = BUILTIN_STAGES[entry.name]
          found.push({
            name: fm.name ?? entry.name,
            description: fm.description ?? '',
            dir: `${root}/${entry.name}`,
            ...(stage !== undefined ? { stage } : {}),
          })
        } catch { /* skip unreadable */ }
      }
    } catch { /* root absent */ }
    if (found.length > 0) break
  }
  return found.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Build the exact session prompt that materializes one new skill inside the
 * workspace (`.paperlab/skills/<name>/SKILL.md`). The workspace files Remote
 * is read-bounded, so creation is delegated to the agent with a precise,
 * verbatim instruction.
 */
export function skillCreatePrompt(name: string, description: string, body: string): string {
  return [
    `请在当前工作区创建一个新 skill：目录 .paperlab/skills/${name}/，文件 SKILL.md，内容如下（原样写入，不要改动 frontmatter 字段）：`,
    '',
    '---',
    `name: ${name}`,
    'description: >-',
    ...description.split('\n').map(line => `  ${line}`),
    '---',
    '',
    body,
  ].join('\n')
}

/** Build the session prompt that deletes one skill directory. */
export function skillDeletePrompt(dir: string): string {
  return `请删除当前工作区里的 skill 目录 ${dir}（整个目录，含 SKILL.md）。`
}
