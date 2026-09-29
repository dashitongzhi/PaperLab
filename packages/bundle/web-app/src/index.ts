/**
 * @deepseek-ai/dsh-web-app — the browser-surface bundle's runtime glue plugin
 * plus the bundle patch (`cordis.patch.yml`, declared by the `dsh.bundle.patch`
 * manifest field). The plugin owns the browser-surface glue: it resolves
 * the built frontend dist (workspace knowledge of this bundle, never user
 * config), mounts the `frontend-static` fallback owner over it, registers the
 * harness-source and web-surface prompt sections, the bash-visible web runtime
 * variable, the process-token URL line, and the default-browser handoff. The
 * model and shell retain the clean URL. App command-line values arrive through
 * the `webStartup` service expressions in the bundle patch.
 * @module @deepseek-ai/dsh-web-app
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { addHarnessSourceSection, auditStartupEntries } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-client-connection'
import * as FrontendStatic from '@deepseek-ai/dsh-host-frontend-static'
import { launchedThroughSsh, launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-shell-env'

/** Stable Cordis plugin name. */
export const name = 'web-app'

/** This dsh installation's root, from either this package's source or built entry. */
const SOURCE_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))
const ANNOUNCED_ROOTS = new WeakSet<Context>()

/** Runtime service that releases Web rows after bind-dependent values resolve. */
const WEB_RUNTIME_SERVICE = 'webRuntime'

/** Services required before the web runtime can mount. */
export const inject = ['webServer']

import { readdir, readFile, writeFile as fsWriteFile, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'

/** PaperLab skills root inside this repository (built-in pipeline skills). */
const PAPERLAB_SKILLS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../paperlab/skills')


/** Plugin config: composed deployment settings plus per-invocation command-line values. */
export interface Config {
  /** Permit default-browser handoff after the Loader tree settles; an SSH launch suppresses it. */
  openBrowser: boolean
  /** Print the URL line on activation; a non-interactive layer can turn it off. */
  printUrl: boolean
  /**
   * Register the model-visible surface context (the `app:web-surface` prompt
   * section and the `DSH_WEB_URL` bash variable). A one-shot non-interactive
   * layer can turn it off when its user is not in the GUI, so the
   * orientation text would be false.
   */
  surfaceContext: boolean
  /** Explicit `--trusted-host` authorities from this invocation. */
  trustedHosts: string[]
}

export const Config: z<Config> = z.object({
  openBrowser: z.boolean().default(true),
  printUrl: z.boolean().default(true),
  surfaceContext: z.boolean().default(true),
  trustedHosts: z.array(String).default([]),
})

/** Bind-dependent Web values shared by the trust fence and URL display. */
export interface WebRuntimeValues {
  /** LAN IPv4 literals sampled once when the server binds all interfaces. */
  lanAddresses: string[]
  /** LAN literals followed by explicit invocation authorities. */
  trustedHosts: string[]
}

/** Environment variable naming the canonical local URL of this Web GUI. */
const DSH_WEB_URL = 'DSH_WEB_URL' as const

// Display-only mirror of the webserver schema's loopback host: the address the
// local URL always prints. Not a source of truth — the schema is.
const LOOPBACK_HOST = '127.0.0.1'
/** The webserver schema's all-interfaces bind literal. */
const ALL_INTERFACES_HOST = '0.0.0.0'

const BROWSER_OPENER_MODULE = import.meta.resolve('open')

const BROWSER_OPENER_PROGRAM = `
try {
  const { default: open } = await import(${JSON.stringify(BROWSER_OPENER_MODULE)})
  const launcher = await open(process.argv[1])
  if (process.platform === 'win32') {
    // open resolves at PowerShell spawn; keep it referenced until that launcher hands the URL to Windows.
    const code = launcher.exitCode ?? await new Promise((resolve, reject) => {
      function onError(error) {
        launcher.off('close', onClose)
        reject(error)
      }
      function onClose(code) {
        launcher.off('error', onError)
        resolve(code)
      }
      launcher.ref()
      launcher.once('error', onError)
      launcher.once('close', onClose)
    })
    if (code !== 0) throw new Error('browser operating-system launcher exited with code ' + String(code))
  }
  process.exitCode = 0
} catch (error) {
  // The parent turns this exit into the manual-URL warning.
  console.error(error)
  process.exitCode = 1
}
`

/**
 * Resolve one LAN-trust snapshot from the active server bind.
 *
 * Derived entries are port-less IP literals: DNS rebinding needs an
 * attacker-controlled name, while an IP-literal Host is safe on any port and
 * an OS-assigned port is unknowable before bind.
 * @param bindHost - the active webserver bind host.
 * @param extra - explicit `--trusted-host` values, in argument order.
 * @returns the LAN display addresses and invocation-derived fence authorities.
 */
export function resolveLanTrust(bindHost: string, extra: readonly string[]): WebRuntimeValues {
  const lanAddresses = bindHost === ALL_INTERFACES_HOST
    ? Object.values(networkInterfaces()).flat()
      .filter((iface): iface is NonNullable<typeof iface> => iface !== undefined && iface.family === 'IPv4' && !iface.internal)
      .map(iface => iface.address)
    : []
  return { lanAddresses, trustedHosts: [...lanAddresses, ...extra] }
}

/** Model-visible orientation and acceptance boundary for sessions created through `dsh web`. */
function webSurfacePrompt(webUrl: string): string {
  const updateContract = 'The client-plugin HMR receiver is active, but client-plugin changes reload without a refresh only while '
    + '`pnpm run dev:web` is also running from this same checkout to rebuild their bundles; verify that watcher before promising automatic updates. '
    + 'Every other change — the apps/web shell and plain packages — requires rebuilding the affected Web artifacts and verifying this existing URL after a page refresh. '
  return `You are interacting with the user through the PaperLab workbench at ${webUrl}. `
    + 'When the user refers to "this page", "this app", or "the workbench" without naming another target, they mean this PaperLab workbench. '
    + 'The browser provides no implicit DOM, route, or screenshot context. '
    + updateContract
    + 'Starting another server does not update this GUI. '
    + ''
    + 'Do not start a replacement server unless the user asks; if one is needed, use a managed background job and verify its exact URL.'
}

/** Resolve the canonical loopback URL from the active Web server. */
function localWebUrl(ctx: Context): string {
  const port = ctx.get('webServer')?.port
  if (port === undefined) throw new Error('web-app: webServer service missing while resolving Web runtime')
  return `http://${LOOPBACK_HOST}:${String(port)}`
}

/**
 * Dist location is workspace knowledge of this bundle: anchored on the
 * frontend package manifest, not configured. Existence is a request-time
 * concern — the fallback owner reads files per request, so a composition
 * whose page never reaches the fallback seat (the static worker preview
 * ships its own page and carries no dist) boots without one.
 */
function resolveDistIndex(): string {
  const require = createRequire(import.meta.url)
  try {
    return join(dirname(require.resolve('@deepseek-ai/dsh-web-frontend/package.json')), 'dist', 'index.html')
  } catch {
    /* v8 ignore next 2 -- reachable only when the frontend package is absent from the checkout */
    throw new Error('web-app: @deepseek-ai/dsh-web-frontend is not resolvable from this composition')
  }
}

/** Start the maintained platform opener without forwarding Harness credentials. */
function spawnBrowserLauncher(url: string): ChildProcess {
  return spawn(process.execPath, [
    '--input-type=module',
    '--eval', BROWSER_OPENER_PROGRAM,
    '--', url,
  ], {
    env: scrubbedParentEnv(),
    stdio: ['ignore', 'inherit', 'pipe'],
  })
}

/** Hand one URL to the operating system's default browser. */
async function openBrowser(url: string): Promise<void> {
  const launcher = spawnBrowserLauncher(url)
  let launcherStderr = ''
  launcher.stderr?.setEncoding('utf8')
  launcher.stderr?.on('data', (chunk: string) => { launcherStderr += chunk })
  await new Promise<void>((resolve, reject) => {
    function onError(error: Error): void {
      launcher.off('close', onClose)
      reject(error)
    }
    function onClose(code: number | null): void {
      launcher.off('error', onError)
      if (code !== 0) {
        const firstLine = launcherStderr.trim().split(/\r?\n/u)[0]
        const reason = firstLine === undefined || firstLine === ''
          ? `browser launcher exited with code ${String(code)}`
          : firstLine.replace(/^(?:[A-Za-z]*Error):\s*/u, '')
        reject(new Error(reason))
        return
      }
      if (launcherStderr !== '') process.stderr.write(launcherStderr)
      resolve()
    }
    launcher.once('error', onError)
    launcher.once('close', onClose)
  })
}

/** Test hooks for the built dist and native browser handoff; production never mutates them. */
export const internals: {
  resolveDistIndex: () => string
  openBrowser: (url: string) => Promise<void>
} = { resolveDistIndex, openBrowser }

/**
 * Mount the Web runtime: dist serving, surface prompt, the bash runtime
 * variable, the URL line, and the default-browser handoff.
 * @param ctx - plugin context carrying the webServer service.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const runtime = resolveLanTrust(ctx.webServer.host, config.trustedHosts)

  // PaperLab skills library: platform-level HTTP API (session-independent).
  ctx.webServer.register({
    kind: 'prefix',
    path: '/api/paperlab/skills',
    handler: async (_req, res) => {
      const skillsRoot = process.env.PAPERLAB_SKILLS_ROOT ?? PAPERLAB_SKILLS_ROOT
      try {
        const requestUrl = _req.url ?? ''
        // POST /api/paperlab/skills/install — install from a git URL, or
        // author a new skill from a natural-language description (the description
        // is returned as a ready-to-run session prompt; the agent writes SKILL.md).
        if (_req.method === 'POST' && requestUrl.includes('/api/paperlab/skills/install')) {
          const chunks: Buffer[] = []
          for await (const chunk of _req) chunks.push(chunk as Buffer)
          let input: { url?: string; name?: string; description?: string; body?: string } = {}
          try { input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { /* bad body */ }
          if (input.url !== undefined && input.url.trim() !== '') {
            const raw = input.url.trim()
            if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(raw)) return json(res, 400, { error: '仅支持 GitHub 仓库链接' })
            const url = raw.replace(/\.git$/, '')
            const skillName = url.split('/').pop() ?? `skill-${Date.now()}`
            const { execFile } = await import('node:child_process')
            const skillsRoot = process.env.PAPERLAB_SKILLS_ROOT ?? PAPERLAB_SKILLS_ROOT
            const dest = join(skillsRoot, skillName)
            execFile('git', ['clone', '--depth', '1', url, dest], { timeout: 60_000 }, (err) => {
              if (err) return json(res, 500, { error: `克隆失败: ${String(err.message)}` })
              json(res, 200, { ok: true, name: skillName })
            })
            return
          }
          if (input.name !== undefined && input.name.trim() !== '') {
            const { execFile } = await import('node:child_process')
            const { writeFile } = await import('node:fs/promises')
            const skillsRoot = process.env.PAPERLAB_SKILLS_ROOT ?? PAPERLAB_SKILLS_ROOT
            const skillName = input.name.trim()
            const dest = join(skillsRoot, skillName)
            const front = ['---', `name: ${skillName}`, 'description: >-',
              ...(input.description ?? '用户自定义技能').split('\n').map(l => `  ${l}`), '---', '', input.body ?? ''].join('\n')
            execFile('mkdir', ['-p', dest], { timeout: 10_000 }, (err) => {
              if (err) return json(res, 500, { error: `创建目录失败: ${String(err.message)}` })
              void writeFile(join(dest, 'SKILL.md'), front, 'utf8').then(() => json(res, 200, { ok: true, name: skillName }))
                .catch((e: unknown) => json(res, 500, { error: String(e) }))
            })
            return
          }
          return json(res, 400, { error: '需要 url 或 name 字段' })
        }
        if (requestUrl.includes('/api/paperlab/skills/content/')) {
          const rawName = (requestUrl.split('/api/paperlab/skills/content/')[1] ?? '').split('?')[0]
          const name = sanitizeName(decodeURIComponent(rawName ?? ''))
          const md = await readFile(join(skillsRoot, name, 'SKILL.md'), 'utf8')
          return json(res, 200, { name, content: md })
        }
        const entries = await readdir(skillsRoot, { withFileTypes: true })
        const skills = []
        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          try {
            const md = await readFile(join(skillsRoot, entry.name, 'SKILL.md'), 'utf8')
            const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md)
            const pick = (key: string): string => {
              const m = fm?.[1] ? new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(fm[1]) : undefined
              return m?.[1]?.trim() ?? ''
            }
            skills.push({ name: pick('name') || entry.name, description: pick('description'), dir: entry.name })
          } catch { /* skip dirs without SKILL.md */ }
        }
        json(res, 200, { skills })
      } catch (error) {
        json(res, 500, { error: String(error) })
      }
    },
  })

  // PaperLab workflow center: the built-in paper pipeline plus user-authored
  // workflows, stored as JSON files in packages/paperlab/workflows/.
  ctx.webServer.register({
    kind: 'prefix',
    path: '/api/paperlab/workflows',
    handler: async (_req, res) => {
      const workflowsRoot = process.env.PAPERLAB_WORKFLOWS_ROOT
        ?? join(dirname(fileURLToPath(import.meta.url)), '../../../paperlab/workflows')
      const requestUrl = _req.url ?? ''
      const readJson = async (id: string): Promise<string | undefined> => {
        if (!/^[a-z0-9-]{1,64}$/.test(id)) return undefined
        const path = join(workflowsRoot, `${id}.json`)
        return existsSync(path) ? readFile(path, 'utf8') : undefined
      }
      const writeJson = async (id: string, body: string): Promise<void> => {
        await mkdir(workflowsRoot, { recursive: true })
        await fsWriteFile(join(workflowsRoot, `${id}.json`), body, 'utf8')
      }
      const readBody = async (): Promise<Record<string, unknown>> => {
        const chunks: Buffer[] = []
        for await (const chunk of _req) chunks.push(chunk as Buffer)
        try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { return {} }
      }
      try {
        // POST /save — assemble the full document and write it back. The
        // builtin flag always comes from the stored file, never the body.
        if (_req.method === 'POST' && requestUrl.includes('/api/paperlab/workflows/save')) {
          const input = await readBody()
          const id = typeof input.id === 'string' ? input.id : ''
          if (!/^[a-z0-9-]{1,64}$/.test(id)) return json(res, 400, { error: 'invalid id' })
          const stored = await readJson(id)
          if (stored === undefined) return json(res, 404, { error: '工作流不存在' })
          const previous = JSON.parse(stored) as { builtin?: boolean }
          const document = {
            id,
            name: typeof input.name === 'string' && input.name.trim() !== '' ? input.name.trim() : id,
            description: typeof input.description === 'string' ? input.description : '',
            builtin: previous.builtin === true,
            stages: Array.isArray(input.stages) ? input.stages : [],
          }
          await writeJson(id, `${JSON.stringify(document, null, 2)}\n`)
          return json(res, 200, { ok: true, id })
        }
        // POST /create — a minimal one-stage skeleton from a name.
        if (_req.method === 'POST' && requestUrl.includes('/api/paperlab/workflows/create')) {
          const input = await readBody()
          const name = typeof input.name === 'string' && input.name.trim() !== '' ? input.name.trim() : '新工作流'
          const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)
          const id = `${slug || 'workflow'}-${Math.random().toString(36).slice(2, 6)}`
          const document = {
            id, name,
            description: typeof input.description === 'string' ? input.description : '',
            builtin: false,
            stages: [{ id: 'stage-1', name: '新阶段', goal: '', tools: [] as string[], steps: [] as string[], gate: '无' }],
          }
          await writeJson(id, `${JSON.stringify(document, null, 2)}\n`)
          return json(res, 200, { ok: true, id })
        }
        // POST /delete — refuse for the built-in pipeline.
        if (_req.method === 'POST' && requestUrl.includes('/api/paperlab/workflows/delete')) {
          const input = await readBody()
          const id = typeof input.id === 'string' ? input.id : ''
          const stored = await readJson(id)
          if (stored === undefined) return json(res, 404, { error: '工作流不存在' })
          if ((JSON.parse(stored) as { builtin?: boolean }).builtin === true) {
            return json(res, 400, { error: '内置工作流不可删除，可复制后修改' })
          }
          await rm(join(workflowsRoot, `${id}.json`))
          return json(res, 200, { ok: true })
        }
        // GET /content/<id> — the raw document.
        const contentMatch = /\/api\/paperlab\/workflows\/content\/([a-z0-9-]+)/.exec(requestUrl)
        if (contentMatch !== null) {
          const raw = await readJson(contentMatch[1] ?? '')
          if (raw === undefined) return json(res, 404, { error: '工作流不存在' })
          return json(res, 200, { id: contentMatch[1], json: raw })
        }
        // GET / — the summary list.
        const entries = await readdir(workflowsRoot, { withFileTypes: true }).catch(() => [])
        const workflows = []
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.json')) continue
          try {
            const parsed = JSON.parse(await readFile(join(workflowsRoot, entry.name), 'utf8')) as {
              id?: string; name?: string; description?: string; builtin?: boolean; stages?: unknown[]
            }
            workflows.push({ id: parsed.id ?? entry.name.replace(/\.json$/, ''), name: parsed.name ?? entry.name,
              description: parsed.description ?? '', builtin: parsed.builtin === true,
              stages: parsed.stages ?? [] })
          } catch { /* skip malformed files */ }
        }
        workflows.sort((left, right) => (left.builtin === right.builtin ? 0 : left.builtin ? -1 : 1))
        return json(res, 200, { workflows })
      } catch (error) {
        json(res, 500, { error: String(error) })
      }
    },
  })

  // The loopback URL belongs to this host. Under SSH, the operator reaches it
  // through a local forwarding address that this process cannot derive.
  const handoffBrowser = config.openBrowser && !launchedThroughSsh(launchEnvironmentOf(ctx))
  // Release dependent rows only after bind-dependent trust has been sampled once.
  ctx.provide(WEB_RUNTIME_SERVICE, runtime)
  ctx.plugin(FrontendStatic, { distIndex: internals.resolveDistIndex() })
  if (config.surfaceContext) {
    ctx.inject(['systemPrompt'], (promptCtx) => {
      addHarnessSourceSection(promptCtx, SOURCE_ROOT)
      promptCtx.systemPrompt.section({
        name: 'app:web-surface',
        order: promptCtx.systemPrompt.getSectionOrder('WEB_SURFACE'),
        text: () => webSurfacePrompt(localWebUrl(promptCtx)),
      })
    })
    ctx.inject(['shellEnv'], (runtimeCtx) => {
      runtimeCtx.shellEnv.register({
        name: 'web-runtime',
        variables: {
          [DSH_WEB_URL]: { description: 'Canonical local URL of the DeepSeek Harness Web GUI serving this session.' },
        },
        resolve: () => ({ [DSH_WEB_URL]: localWebUrl(runtimeCtx) }),
      })
    })
  }
  if (config.printUrl || handoffBrowser) {
    ctx.inject(['connection'], (connectionCtx) => {
      // The URL line and browser handoff are readiness signals: supervisors RPC
      // as soon as they observe the line, while a browser requests the page as
      // soon as it opens. Neither may run while sibling rows such as the /api
      // route owner are still mounting. Await Loader settlement first; a
      // hand-built tree without a Loader is already the complete tree.
      const announceReady = (): void => {
        if (ANNOUNCED_ROOTS.has(connectionCtx.root)) return
        const webUrl = localWebUrl(connectionCtx)
        const authenticatedUrl = connectionCtx.connection.authenticatedUrl(webUrl)
        // Reuse the exact LAN snapshot provided to the /api trust fence.
        const lanCandidate = runtime.lanAddresses[0]
        const port = connectionCtx.webServer.port
        const lanUrl = lanCandidate === undefined
          ? undefined
          : connectionCtx.connection.authenticatedUrl(`http://${lanCandidate}:${String(port)}`)
        ANNOUNCED_ROOTS.add(connectionCtx.root)
        if (config.printUrl) {
          console.log(`dsh web: ${authenticatedUrl}${lanUrl === undefined ? '' : ` (LAN: ${lanUrl})`}`)
        }
        if (handoffBrowser) {
          console.log('dsh web: opening the default browser; pass --no-open to disable')
          void internals.openBrowser(authenticatedUrl).catch((error: unknown) => {
            const reason = error instanceof Error ? error.message : String(error)
            console.error(`web-app: could not open the default browser because ${reason}; use the dsh web URL printed at startup`)
          })
        }
      }
      // This row's own activation can precede a sibling failure. The app owns
      // readiness by waiting for its Loader tree, or announces at once in a
      // hand-built tree without Loader.
      const settled = connectionCtx.get('loader')?.await()
      if (settled === undefined) announceReady()
      else {
        void settled.then(async () => {
          await auditStartupEntries(connectionCtx.root, 'dsh web', () => {})
          // The tree can be disposed while the boot was in flight (early
          // SIGTERM); a URL line or browser tab for a dead server would only
          // mislead, and reading torn-down services would turn a clean shutdown
          // into a crash.
          if (connectionCtx.get('webServer') !== undefined
            && connectionCtx.get('connection') !== undefined) announceReady()
        }).catch(() => {
          // Boot owns the failure diagnostic; readiness remains unpublished.
        })
      }
    })
  }
}

/** Send one JSON response and close it. */
function json(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Allow only safe directory names (no traversal, no separators). */
function sanitizeName(raw: string): string {
  const name = raw.replace(/[^a-zA-Z0-9_-]/g, '')
  if (name !== raw || name === '' || name.startsWith('.')) throw new Error('invalid skill name')
  return name
}
