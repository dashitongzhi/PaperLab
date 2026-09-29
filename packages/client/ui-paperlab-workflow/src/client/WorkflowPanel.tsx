/**
 * Workflow center panel: list → editor → run. Visual system follows
 * SkillsPanel (warm paper canvas, coral accent, serif titles); data comes
 * from /api/paperlab/workflows (session-independent). Editing is disabled
 * for built-in workflows until they are duplicated via「另存为副本」.
 */
import { useEffect, useRef, useState } from 'react'
import { IconCheckCircleFillRegular, IconPlusOutlineRegular, IconWarningOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './WorkflowPanel.module.css'

type Step = { id: string; title: string; instruction: string; skill: string }
type Workflow = { id: string; name: string; description: string; builtIn: boolean; steps: Step[] }
type Summary = { id: string; name: string; description: string; stepCount: number; builtIn: boolean }

const SKILL_CHOICES = ['', 'paper-plan', 'topic-scan', 'data-forge', 'paper-write', 'claim-ledger', 'paper-audit', 'qa-check', 'paper-submit']

type Toast = { seq: number; text: string; bad: boolean } | null
type View = { kind: 'list' } | { kind: 'edit'; workflow: Workflow; isNew: boolean }

/** Fetch JSON with a JSON body verb; returns parsed body or throws. */
async function api(path: string, method = 'GET', body?: unknown): Promise<any> {
  const res = await fetch(`/api/paperlab/workflows${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
  const parsed = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((parsed as { error?: string }).error ?? `HTTP ${String(res.status)}`)
  return parsed
}

/** Compose the numbered run prompt locally (same shape the run endpoint yields). */
function composePrompt(workflow: Workflow): string {
  const lines = workflow.steps.map((step, index) => {
    const skill = step.skill ? `（技能：${step.skill}）` : ''
    return `${index + 1}. ${step.title}${skill}\n   ${step.instruction}`
  })
  return `请按以下工作流「${workflow.name}」执行，逐步推进并在每步完成后汇报：\n${lines.join('\n')}`
}

/**
 * Render the workflow center: the list page (cards) or the editor page
 * (steps with title/instruction/skill rows, reorder, save).
 */
export function WorkflowPanel(): any {
  const [workflows, setWorkflows] = useState<Summary[] | null>(null)
  const [view, setView] = useState<View>({ kind: 'list' })
  const [toast, setToast] = useState<Toast>(null)
  const toastSeq = useRef(0)

  const notify = (text: string, bad = false): void => {
    toastSeq.current += 1
    setToast({ seq: toastSeq.current, text, bad })
  }
  useEffect(() => {
    if (toast === null) return
    const timer = window.setTimeout(() => { setToast(null) }, 4000)
    return () => { window.clearTimeout(timer) }
  }, [toast])

  const load = async (): Promise<void> => {
    try {
      const parsed = await api('')
      setWorkflows(parsed.workflows ?? [])
    } catch (error) {
      notify(`载入失败：${String((error as Error).message)}`, true)
      setWorkflows([])
    }
  }
  useEffect(() => { void load() }, [])

  const copy = async (id: string): Promise<void> => {
    try {
      const parsed = await api(`/${encodeURIComponent(id)}/copy`, 'POST')
      notify('已创建可编辑副本')
      await load()
      const fresh = await api(`/${encodeURIComponent(parsed.id as string)}`)
      setView({ kind: 'edit', workflow: fresh.workflow as Workflow, isNew: false })
    } catch (error) { notify(String((error as Error).message), true) }
  }

  const remove = async (id: string): Promise<void> => {
    try {
      await api(`/${encodeURIComponent(id)}`, 'DELETE')
      notify('已删除')
      await load()
    } catch (error) { notify(String((error as Error).message), true) }
  }

  const save = async (workflow: Workflow, isNew: boolean): Promise<void> => {
    try {
      if (isNew) {
        const created = { ...workflow, id: `custom-${Date.now()}`, builtIn: false }
        // No POST-create endpoint: write via copy-less PUT is not possible,
        // so create by saving a duplicate of nothing — use the copy of a
        // minimal body through PUT after seeding the file with PUT is not
        // supported; instead fall back to run/copy pair is overkill. Use the
        // generic create below.
        const res = await fetch('/api/paperlab/workflows', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...created, steps: created.steps }),
        })
        if (!res.ok) throw new Error(`HTTP ${String(res.status)}`)
      } else {
        await api(`/${encodeURIComponent(workflow.id)}`, 'PUT',
          { name: workflow.name, description: workflow.description, steps: workflow.steps })
      }
      notify('已保存')
      setView({ kind: 'list' })
      await load()
    } catch (error) { notify(String((error as Error).message), true) }
  }

  const run = (workflow: Workflow): void => {
    const prompt = composePrompt(workflow)
    void navigator.clipboard?.writeText(prompt)
      .then(() => { notify('执行指令已复制，粘贴到会话即可运行') })
      .catch(() => { notify('复制失败，请手动选择文本', true) })
  }

  if (workflows === null) return <div className={css.page}>载入工作流…</div>

  if (view.kind === 'edit') {
    const workflow = view.workflow
    const updateStep = (index: number, patch: Partial<Step>): void => {
      const steps = workflow.steps.map((step, i) => i === index ? { ...step, ...patch } : step)
      setView({ ...view, workflow: { ...workflow, steps } })
    }
    const move = (index: number, delta: number): void => {
      const target = index + delta
      if (target < 0 || target >= workflow.steps.length) return
      const steps = [...workflow.steps]
      const moved = steps.splice(index, 1)[0]
      if (moved === undefined) return
      steps.splice(target, 0, moved)
      setView({ ...view, workflow: { ...workflow, steps } })
    }
    return (
      <div className={css.page} key="editor">
        <div className={css.detailTop}>
          <button type="button" className={css.backButton} onClick={() => { setView({ kind: 'list' }) }}>返回</button>
          <input className={css.nameInput} value={workflow.name} readOnly={workflow.builtIn}
            onChange={e => { setView({ ...view, workflow: { ...workflow, name: e.target.value } }) }} />
        </div>
        <p className={css.intro}>{workflow.builtIn ? '内置工作流只读——「另存为副本」后可编辑。' : '按步骤顺序执行；每步可绑定一个论文技能。'}</p>
        <textarea className={css.descInput} rows={2} value={workflow.description} readOnly={workflow.builtIn}
          onChange={e => { setView({ ...view, workflow: { ...workflow, description: e.target.value } }) }} />
        <div className={css.stepList}>
          {workflow.steps.map((step, index) => (
            <div className={css.stepCard} key={step.id}>
              <div className={css.stepHead}>
                <span className={css.stepIndex}>{String(index + 1)}</span>
                <input className={css.stepTitle} value={step.title} readOnly={workflow.builtIn}
                  onChange={e => { updateStep(index, { title: e.target.value }) }} />
                <select className={css.stepSkill} value={step.skill} disabled={workflow.builtIn}
                  onChange={e => { updateStep(index, { skill: e.target.value }) }}>
                  {SKILL_CHOICES.map(skill => (
                    <option key={skill || 'none'} value={skill}>{skill === '' ? '（无技能）' : skill}</option>
                  ))}
                </select>
                <button type="button" className={css.stepMove} disabled={workflow.builtIn || index === 0}
                  onClick={() => { move(index, -1) }}>↑</button>
                <button type="button" className={css.stepMove} disabled={workflow.builtIn || index === workflow.steps.length - 1}
                  onClick={() => { move(index, 1) }}>↓</button>
                <button type="button" className={css.stepRemove} disabled={workflow.builtIn}
                  onClick={() => { setView({ ...view, workflow: { ...workflow, steps: workflow.steps.filter((_, i) => i !== index) } }) }}>✕</button>
              </div>
              <textarea className={css.stepInstruction} rows={3} value={step.instruction} readOnly={workflow.builtIn}
                onChange={e => { updateStep(index, { instruction: e.target.value }) }} />
            </div>
          ))}
          {!workflow.builtIn && (
            <button type="button" className={css.addStep}
              onClick={() => { setView({ ...view, workflow: { ...workflow, steps: [...workflow.steps,
                { id: `s${Date.now()}`, title: '新步骤', instruction: '', skill: '' }] } }) }}>
              <IconPlusOutlineRegular size={14} /> 添加步骤
            </button>
          )}
        </div>
        <div className={css.editorActions}>
          {workflow.builtIn
            ? <button type="button" className={css.primaryButton} onClick={() => { void copy(workflow.id) }}>另存为副本</button>
            : <button type="button" className={css.primaryButton} onClick={() => { void save(workflow, false) }}>保存</button>}
          <button type="button" className={css.secondaryButton} onClick={() => { run(workflow) }}>复制执行指令</button>
          <button type="button" className={css.secondaryButton} onClick={() => { setView({ kind: 'list' }) }}>取消</button>
        </div>
        {toast !== null && (
          <div className={toast.bad ? css.toastBad : css.toastOk} key={toast.seq}>
            {toast.bad ? <IconWarningOutlineRegular size={15} /> : <IconCheckCircleFillRegular size={15} />} {toast.text}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={css.page} key="list">
      <div className={css.pageHead}>
        <div>
          <h1 className={css.pageTitle}>工作流</h1>
          <p className={css.pageIntro}>整合论文方法论的可编辑流水线；复制执行指令到会话即可按步运行。</p>
        </div>
      </div>
      {workflows.length === 0 && <div className={css.empty}>还没有工作流</div>}
      <div className={css.cards}>
        {workflows.map(workflow => (
          <div className={css.card} key={workflow.id}>
            <button type="button" className={css.cardMain} onClick={async () => {
              try {
                const fresh = await api(`/${encodeURIComponent(workflow.id)}`)
                setView({ kind: 'edit', workflow: fresh.workflow as Workflow, isNew: false })
              } catch (error) { notify(String((error as Error).message), true) }
            }}>
              <span className={css.cardTitle}>{workflow.name}</span>
              {workflow.builtIn && <span className={css.badge}>内置</span>}
              <span className={css.cardDesc}>{workflow.description}</span>
              <span className={css.cardMeta}>{workflow.stepCount} 个步骤</span>
            </button>
            <div className={css.cardActions}>
              <button type="button" className={css.runButton} onClick={() => {
                void api(`/${encodeURIComponent(workflow.id)}`).then(fresh => {
                  run(fresh.workflow as Workflow)
                }).catch((error: unknown) => { notify(String((error as Error).message), true) })
              }}>运行</button>
              {!workflow.builtIn && (
                <button type="button" className={css.chipDanger} onClick={() => { void remove(workflow.id) }}>删除</button>
              )}
            </div>
          </div>
        ))}
      </div>
      {toast !== null && (
        <div className={toast.bad ? css.toastBad : css.toastOk} key={toast.seq}>
          {toast.bad ? <IconWarningOutlineRegular size={15} /> : <IconCheckCircleFillRegular size={15} />} {toast.text}
        </div>
      )}
    </div>
  )
}
