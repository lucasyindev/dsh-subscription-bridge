/** Native OAuth surface: no credential payload reads, provider adapters or token files. */
import type { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials'
import type { AuthorizationEntry, AuthorizationPrompt } from '@deepseek-ai/dsh-authorization'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-llm'
import { randomUUID } from 'node:crypto'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import type { FlowView, PromptView } from './types.js'

export const name = 'subscription-bridge'
export const inject = ['authorization', 'credentials', 'connection', 'settings', 'llm']
export const RPC_PREFIX = 'subscription-bridge.'
export const RPC_CHANNEL = '/api'
const actions = new Set(['list', 'begin', 'answer', 'cancel', 'signOut', 'enable'])
interface Pending { view: PromptView; resolve(value: string): void; reject(reason: Error): void; cleanup(): void }
interface Attempt { controller: AbortController; done: Promise<void>; state: FlowView['outcome']; prompts: Map<string, Pending>; notice?: FlowView['notice'] }
class Refusal extends Error { constructor(readonly code: string) { super(code) } }

/** Own only UI conversations; official authorization owns writes and cancellation. */
export class SubscriptionBridge {
  private readonly attempts = new Map<CredentialKey, Attempt>()
  private readonly deleting = new Set<CredentialKey>()
  private disposed = false
  constructor(private readonly ctx: Context) {}

  private flows(): readonly AuthorizationEntry[] {
    return this.ctx.authorization.list().filter(flow => flow.key.startsWith('llm-pi-ai/') && flow.methods.some(method => method.id === 'oauth'))
  }
  private key(raw: string): CredentialKey {
    const segments = raw.split('/')
    if (segments.length !== 2 || segments[0] !== 'llm-pi-ai') throw new Refusal('invalid-flow')
    let key: CredentialKey
    try { key = credentialKey('llm-pi-ai', segments[1]!) } catch { throw new Refusal('invalid-flow') }
    if (!this.flows().some(flow => flow.key === key)) throw new Refusal('unsupported-flow')
    return key
  }
  private route(key: CredentialKey) {
    const provider = key.slice('llm-pi-ai/'.length)
    const entries = this.ctx.llm.listConfigurableProviders().filter(entry => entry.provider === provider && entry.settingsPath.length === 2 && entry.settingsPath[0] === 'providers' && entry.settingsPath[1] === provider)
    if (entries.length !== 1) throw new Refusal('ambiguous-route')
    const entry = entries[0]!
    const settings = this.ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === entry.settingsNs)
    if (!settings) throw new Refusal('settings-unavailable')
    const profile = readPath(settings.value, entry.settingsPath)
    const keyReference = isObject(profile) && typeof profile.apiKeyEnv === 'string' && profile.apiKeyEnv.length > 0
    return { entry, settings, profile, keyReference }
  }
  /** Enumerate only supported native OAuth flows and value-free status. */
  async list(): Promise<FlowView[]> {
    const registered = new Set(this.ctx.llm.listProviders().map(provider => provider.id))
    return Promise.all(this.flows().map(async flow => {
      const attempt = this.attempts.get(flow.key)
      let keyReference = false
      try { keyReference = this.route(flow.key).keyReference } catch { /* Missing configuration is exposed by enable refusal, not invented. */ }
      return { ...flow, inFlight: flow.inFlight || (attempt !== undefined && attempt.state === undefined),
        credential: await this.ctx.credentials.describeRecord(flow.key),
        enabled: registered.has(flow.key.slice('llm-pi-ai/'.length)), keyReference,
        prompts: attempt ? [...attempt.prompts.values()].map(pending => pending.view) : [],
        ...(attempt?.notice ? { notice: attempt.notice } : {}),
        ...(attempt?.state ? { outcome: attempt.state } : {}),
      }
    }))
  }
  /** Activate an absent native profile, with revision fencing and no replacement of existing settings. */
  async enable(raw: string): Promise<void> {
    const key = this.key(raw)
    if (this.deleting.has(key)) throw new Refusal('busy')
    const info = await this.ctx.credentials.describeRecord(key)
    if (!info.configured || info.kind !== 'grant') throw new Refusal('not-connected')
    const { entry, settings, profile, keyReference } = this.route(key)
    if (keyReference) throw new Refusal('api-key-reference')
    if (profile !== undefined) return
    await this.ctx.settings.mutate(entry.settingsNs, [{ op: 'set', path: entry.settingsPath, value: {} }], settings.revision)
  }
  /** Begin asynchronously so prompts can be answered by subsequent authenticated RPC calls. */
  begin(raw: string): void {
    if (this.disposed) throw new Refusal('disposed')
    const key = this.key(raw)
    if (this.deleting.has(key) || this.ctx.authorization.describe(key)?.inFlight || this.attempts.get(key)?.state === undefined && this.attempts.has(key)) throw new Refusal('busy')
    const attempt: Attempt = { controller: new AbortController(), done: Promise.resolve(), state: undefined, prompts: new Map() }
    this.attempts.set(key, attempt)
    attempt.done = this.run(key, attempt)
  }
  private async run(key: CredentialKey, attempt: Attempt): Promise<void> {
    try {
      const stored = await this.ctx.credentials.describeRecord(key)
      if (stored.configured && stored.kind !== 'grant') throw new Refusal('not-grant')
      attempt.controller.signal.throwIfAborted()
      const outcome = await this.ctx.authorization.begin({ key, method: 'oauth', signal: attempt.controller.signal,
        interaction: {
          notify: notice => {
            // Progress-only events must not hide a still-needed device code or authorization URL.
            attempt.notice = notice.url === undefined && notice.code === undefined
              ? { ...attempt.notice, message: notice.message }
              : notice
          },
          prompt: prompt => this.ask(attempt, prompt),
        },
      })
      attempt.state = outcome.status
      if (outcome.status === 'authorized' && !this.disposed && !this.deleting.has(key)) {
        try { await this.enable(key) } catch { attempt.state = 'enable-failed' }
      }
    } catch { attempt.state = attempt.controller.signal.aborted ? 'cancelled' : 'failed' }
    finally {
      for (const pending of attempt.prompts.values()) { pending.cleanup(); pending.reject(new Error('Attempt ended')) }
      attempt.prompts.clear()
      attempt.notice = undefined
    }
  }
  private ask(attempt: Attempt, prompt: AuthorizationPrompt): Promise<string> {
    if (attempt.controller.signal.aborted || prompt.signal?.aborted) return Promise.reject(new Error('Prompt withdrawn'))
    const { signal, ...wire } = prompt
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const withdraw = () => { const pending = attempt.prompts.get(id); if (!pending) return; pending.cleanup(); attempt.prompts.delete(id); reject(new Error('Prompt withdrawn')) }
      const cleanup = () => { signal?.removeEventListener('abort', withdraw); attempt.controller.signal.removeEventListener('abort', withdraw) }
      attempt.prompts.set(id, { view: { id, prompt: wire }, resolve, reject, cleanup })
      signal?.addEventListener('abort', withdraw, { once: true })
      attempt.controller.signal.addEventListener('abort', withdraw, { once: true })
    })
  }
  /** Answer one exact prompt; reject stale identities and unoffered select options. */
  answer(raw: string, id: string, value: string): void {
    const attempt = this.attempts.get(this.key(raw))
    const pending = attempt?.prompts.get(id)
    if (!attempt || !pending) throw new Refusal('stale-prompt')
    if (pending.view.prompt.kind === 'select' && !pending.view.prompt.options.some(option => option.id === value)) throw new Refusal('invalid-option')
    pending.cleanup(); attempt.prompts.delete(id); pending.resolve(value)
  }
  /** Cancel only a conversation this plugin owns. */
  cancel(raw: string): void {
    const key = this.key(raw)
    const attempt = this.attempts.get(key)
    if (!attempt || attempt.state !== undefined) throw new Refusal('not-owned')
    attempt.controller.abort(); this.ctx.authorization.cancel(key)
  }
  /** Cancel and await own writes before forgetting a grant; never delete API-key records. */
  async signOut(raw: string): Promise<void> {
    const key = this.key(raw)
    if (this.deleting.has(key)) throw new Refusal('busy')
    const attempt = this.attempts.get(key)
    if (this.ctx.authorization.describe(key)?.inFlight && (!attempt || attempt.state !== undefined)) throw new Refusal('not-owned')
    this.deleting.add(key)
    try {
      if (attempt) { attempt.controller.abort(); this.ctx.authorization.cancel(key); await attempt.done }
      const info = await this.ctx.credentials.describeRecord(key)
      if (info.configured && info.kind !== 'grant') throw new Refusal('not-grant')
      if (info.configured) await this.ctx.credentials.deleteRecord(key)
      this.attempts.delete(key)
    } finally { this.deleting.delete(key) }
  }
  /** Plugin unload stops and awaits owned conversations, with no credential deletion. */
  async dispose(): Promise<void> {
    this.disposed = true
    for (const [key, attempt] of this.attempts) { attempt.controller.abort(); this.ctx.authorization.cancel(key) }
    await Promise.all([...this.attempts.values()].map(attempt => attempt.done))
    this.attempts.clear()
  }
}
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function readPath(value: unknown, path: readonly string[]): unknown { for (const segment of path) { if (!isObject(value)) return undefined; value = value[segment] } return value }
function stringField(input: Record<string, unknown>, field: string): string {
  const value = input[field]
  if (typeof value !== 'string' || value.length === 0 || value.length > 32768) throw new Refusal('invalid-input')
  return value
}
/** Register exact authenticated routes; never occupy the Gateway's /api interceptor. */
export function apply(ctx: Context): void {
  const bridge = new SubscriptionBridge(ctx)
  ctx.effect(() => () => bridge.dispose(), 'subscription-bridge: owned conversations')
  const handle = async (endpoint: string, payload: unknown) => {
    const action = endpoint.slice(RPC_PREFIX.length)
    try {
      if (!endpoint.startsWith(RPC_PREFIX) || !actions.has(action) || !isObject(payload)) throw new Refusal('invalid-input')
      if (action === 'list') return { ok: true, value: await bridge.list() }
      const key = stringField(payload, 'key')
      switch (action) {
        case 'begin': bridge.begin(key); break
        case 'answer': bridge.answer(key, stringField(payload, 'id'), stringField(payload, 'value')); break
        case 'cancel': bridge.cancel(key); break
        case 'signOut': await bridge.signOut(key); break
        case 'enable': await bridge.enable(key); break
      }
      return { ok: true, value: null }
    } catch (error) {
      // Never forward OAuth/library errors: their diagnostics may include codes or tokens.
      const code = error instanceof Refusal ? error.code : 'operation-failed'
      return { ok: false, error: { code, message: code, details: {} } }
    }
  }
  for (const action of actions) {
    const endpoint = `${RPC_PREFIX}${action}`
    ctx.effect(() => ctx.connection.fetch.register({
      path: `${RPC_CHANNEL}/${endpoint}`, methods: ['POST'], requestBody: 'buffered',
      fetch: async request => {
        let body: unknown
        try { body = await request.json() } catch { return new Response('invalid request', { status: 400 }) }
        const parsed = clientRequestSchema.safeParse(body)
        if (!parsed.success || parsed.data.method !== endpoint) return new Response('invalid request', { status: 400 })
        return Response.json({ type: 'server-response', rpcId: parsed.data.rpcId, result: await handle(endpoint, parsed.data.payload) })
      },
    }), `subscription-bridge: ${action} authenticated route`)
  }
}
