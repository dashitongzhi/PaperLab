/**
 * Workflow center panel: list → stage pipeline detail/editor. Visual system
 * follows SkillsPanel (warm paper canvas, coral accent, serif titles); data
 * comes from /api/paperlab/workflows (session-independent).
 */
import { useEffect, useRef, useState } from 'react'
import {
  IconCheckCircleFillRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular,
  IconWarningOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import css from './WorkflowPanel.module.css'

type Stage = {
  id: string
  name: string
  goal: string
  tools: string[]
  steps: string[]
  gate: string
}
type WorkflowSummary = { id: string; name: string; description: string; builtin: boolean; stages: Stage[] }
type Workflow = { id: string; name: string; description: string; builtin: boolean; stages: Stage[] }
type View = { kind: 'list' } | { kind: 'detail'; workflow: Workflow }

type Toast = { seq: number; text: string; bad: boolean } | null

/** Fetch JSON; throws on non-2xx with the server's error message. */
async function api(path: string, method = 'GET', body?: unknown): Promise<any> {
  const res = await fetch(`/api/paperlab/workflows${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
  const parsed = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((parsed as { error?: string }).error ?? `HTTP ${String(res.status)}`)
  return parsed
}

/** Open the workflow in the editor state (a mutable deep copy). */
function editable(workflow: Workflow): Workflow {
  return {
    ...workflow,
    stages: workflow.stages.map(stage => ({ ...stage, tools: [...stage.tools], steps: [...stage.steps] })),
  }
}

/**
 * Render the workflow center: the list page (cards) or the stage pipeline
 * detail page with inline editing.
 */
export function WorkflowPanel(): any {
  const [workflows, setWorkflows] = useState<WorkflowSummary[] | null>(null)
  const [view, setView] = useState<View>({ kind: 'list' })
  const [editing, setEditing] = useState(false)
  const [toast, setToast] = useState<Toast>(null)
  const toastSeq = useRef(0)
  const seq = useRef(0)

  const notify = (text: string, bad = false): void => {
    seq.current += 1
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

  const openDetail = async (id: string): Promise<void> => {
    try {
      const fresh = await api(`/content/${encodeURIComponent(id)}`)
      const parsed = JSON.parse(fresh.json as string) as Workflow
      setView({ kind: 'detail', workflow: parsed })
      setEditing(false)
    } catch (error) { notify(String((error as Error).message), true) }
  }

  const save = async (workflow: Workflow): Promise<void> => {
    try {
      await api('/save', 'POST',
        { id: workflow.id, name: workflow.name, description: workflow.description, stages: workflow.stages })
      notify('已保存')
      setEditing(false)
      await load()
    } catch (error) { notify(String((error as Error).message), true) }
  }

  const create = async (): Promise<void> => {
    try {
      const parsed = await api('/create', 'POST', { name: '新工作流' })
      await openDetail(parsed.id as string)
      setEditing(true)
      await load()
    } catch (error) { notify(String((error as Error).message), true) }
  }

  const remove = async (id: string): Promise<void> => {
    try {
      await api('/delete', 'POST', { id })
      notify('已删除')
      setView({ kind: 'list' })
      await load()
    } catch (error) { notify(String((error as Error).message), true) }
  }

  const patchStage = (index: number, patch: Partial<Stage>): void => {
    if (view.kind !== 'detail') return
    const workflow = view.workflow
    const stages = workflow.stages.map((stage, i) => i === index ? { ...stage, ...patch } : stage)
    setView({ kind: 'detail', workflow: { ...workflow, stages } })
  }

  const moveStage = (index: number, delta: number): void => {
    if (view.kind !== 'detail') return
    const workflow = view.workflow
    const target = index + delta
    if (target < 0 || target >= workflow.stages.length) return
    const stages = [...workflow.stages]
    const moved = stages.splice(index, 1)[0]
    if (moved === undefined) return
    stages.splice(target, 0, moved)
    setView({ kind: 'detail', workflow: { ...workflow, stages } })
  }

  if (workflows === null) return <div className={css.page}>载入工作流…</div>

  if (view.kind === 'detail') {
    const workflow = view.workflow
    return (
      <div className={css.page} key="detail">
        <div className={css.detailTop}>
          <button type="button" className={css.backButton} onClick={() => { setView({ kind: 'list' }); setEditing(false) }}>
            返回
          </button>
          {editing
            ? (
                <input className={css.nameInput} value={workflow.name}
                  onChange={e => { setView({ kind: 'detail', workflow: { ...workflow, name: e.target.value } }) }} />)
            : <span className={css.detailName}>{workflow.name}</span>}
          {workflow.builtin && <span className={css.badge}>内置</span>}
          <span className={css.spacer} />
          {editing
            ? (
                <button type="button" className={css.primaryButton}
                  onClick={() => { void save(workflow) }}>保存</button>)
            : (
                <button type="button" className={css.secondaryButton}
                  onClick={() => { setView({ kind: 'detail', workflow: editable(workflow) }); setEditing(true) }}>编辑</button>)}
          {!workflow.builtin && !editing && (
            <button type="button" className={css.secondaryButton} onClick={() => { void remove(workflow.id) }}>删除</button>
          )}
        </div>
        {editing
          ? (
              <textarea className={css.descInput} rows={2} value={workflow.description}
                onChange={e => { setView({ kind: 'detail', workflow: { ...workflow, description: e.target.value } }) }} />)
          : <p className={css.intro}>{workflow.description}</p>}
        <div className={css.usage}>
          用于会话：在会话里说「按 <b>{workflow.name}</b> 推进当前论文」，智能体会按阶段顺序执行并尊重每道人工闸门。
        </div>
        <div className={css.pipeline}>
          {workflow.stages.map((stage, index) => (
            <div className={css.stageCard} key={stage.id || index}>
              <div className={css.stageRail}>
                <span className={css.stageDot}>{index + 1}</span>
                {index < workflow.stages.length - 1 && <span className={css.stageLine} />}
              </div>
              <div className={css.stageBody}>
                <div className={css.stageHead}>
                  {editing
                    ? (
                        <input className={css.stageNameInput} value={stage.name}
                          onChange={e => { patchStage(index, { name: e.target.value }) }} />)
                    : <span className={css.stageName}>{stage.name}</span>}
                  {stage.gate !== '无' && stage.gate.trim() !== '' && (
                    <span className={css.gateBadge}>人工闸门</span>
                  )}
                  {editing && (
                    <span className={css.stageTools2}>
                      <button type="button" className={css.stepBtn} disabled={index === 0}
                        onClick={() => { moveStage(index, -1) }}>↑</button>
                      <button type="button" className={css.stepBtn}
                        disabled={index === workflow.stages.length - 1}
                        onClick={() => { moveStage(index, 1) }}>↓</button>
                      <button type="button" className={css.stepBtn}
                        onClick={() => {
                          setView({ kind: 'detail', workflow: { ...workflow,
                            stages: workflow.stages.filter((_, i) => i !== index) } })
                        }}>✕</button>
                    </span>
                  )}
                </div>
                {editing
                  ? (
                      <input className={css.stageGoalInput} value={stage.goal} placeholder="阶段目标"
                        onChange={e => { patchStage(index, { goal: e.target.value }) }} />)
                  : <p className={css.stageGoal}>{stage.goal}</p>}
                <div className={css.toolChips}>
                  {stage.tools.map((tool, toolIndex) => (
                    editing
                      ? (
                          <input key={toolIndex} className={css.toolChipInput} value={tool}
                            onChange={e => {
                              const tools = [...stage.tools]
                              tools[toolIndex] = e.target.value
                              patchStage(index, { tools })
                            }} />)
                      : <span className={css.toolChip} key={toolIndex}>{tool}</span>
                  ))}
                  {editing && (
                    <button type="button" className={css.stepBtn}
                      onClick={() => { patchStage(index, { tools: [...stage.tools, ''] }) }}>+ 工具</button>
                  )}
                </div>
                <ol className={css.stepsList}>
                  {stage.steps.map((step, stepIndex) => (
                    <li key={stepIndex}>
                      {editing
                        ? (
                            <input className={css.stepInput} value={step}
                              onChange={e => {
                                const steps = [...stage.steps]
                                steps[stepIndex] = e.target.value
                                patchStage(index, { steps })
                              }} />)
                        : step}
                      {editing && (
                        <button type="button" className={css.stepBtn}
                          onClick={() => { patchStage(index, { steps: stage.steps.filter((_, i) => i !== stepIndex) }) }}>✕</button>
                      )}
                    </li>
                  ))}
                </ol>
                {editing && (
                  <button type="button" className={css.stepBtn}
                    onClick={() => { patchStage(index, { steps: [...stage.steps, ''] }) }}>+ 步骤</button>
                )}
                <div className={css.gateRow}>
                  {editing
                    ? (
                        <input className={css.gateInput} value={stage.gate} placeholder="闸门（无 = 无人工确认）"
                          onChange={e => { patchStage(index, { gate: e.target.value }) }} />)
                    : stage.gate !== '无' && stage.gate.trim() !== '' && (
                      <span className={css.gateText}>闸门：{stage.gate}</span>)
                  }
                </div>
              </div>
            </div>
          ))}
          {editing && (
            <button type="button" className={css.addStage}
              onClick={() => {
                setView({ kind: 'detail', workflow: { ...workflow, stages: [...workflow.stages,
                  { id: `stage-${Date.now()}`, name: '新阶段', goal: '', tools: [], steps: [], gate: '无' }] } })
              }}>
              <IconPlusOutlineRegular size={14} /> 添加阶段
            </button>
          )}
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
          <h1 className={css.pageTitle}>论文工作流</h1>
          <p className={css.pageIntro}>把论文从想法推进到投稿：阶段、工具与人工闸门，全程可编辑。</p>
        </div>
        <button type="button" className={css.refreshButton} aria-label="刷新"
          onClick={() => { void load() }}>
          <IconRefreshOutlineRegular size={15} />
        </button>
      </div>
      {workflows.length === 0 && <div className={css.empty}>还没有工作流</div>}
      <div className={css.cards}>
        {workflows.map(workflow => (
          <div className={css.card} key={workflow.id}>
            <button type="button" className={css.cardMain} onClick={() => { void openDetail(workflow.id) }}>
              <span className={css.cardMark}>W</span>
              <span className={css.cardTitle}>{workflow.name}</span>
              {workflow.builtin && <span className={css.badge}>内置</span>}
              <span className={css.cardDesc}>{workflow.description}</span>
              <span className={css.cardMeta}>{workflow.stages.length} 阶段</span>
            </button>
            <div className={css.cardActions}>
              <button type="button" className={css.runButton} onClick={() => { void openDetail(workflow.id) }}>查看</button>
              <button type="button" className={css.chipAdd} onClick={() => { void create() }}>
                <IconPlusOutlineRegular size={12} /> 新建
              </button>
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
