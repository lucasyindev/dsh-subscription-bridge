/** Account-scoped Codex catalog; native pi owns authentication and token refresh. */
import type { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { createModels, type Credential } from '@earendil-works/pi-ai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import type { CatalogStatus } from './types.js'

const KEY = credentialKey('llm-pi-ai', 'openai-codex')
// Catalog wire compatibility baseline, NOT our product version or a Codex CLI identity.
export const CATALOG_URL = 'https://chatgpt.com/backend-api/codex/models?client_version=0.159.0'
const LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
export interface CatalogModel { id: string; name: string; contextWindow: number; input: ('text' | 'image')[]; reasoningEfforts: false | Record<string, string>; maxTokens?: number }
export class CatalogError extends Error {}
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
/** Whitelist metadata only. Never import server instructions, tools or endpoints. */
export function parseCatalog(body: unknown): CatalogModel[] {
  if (!object(body) || !Array.isArray(body.models) || body.models.length > 1000) throw new CatalogError('catalog-invalid')
  const seen = new Set<string>()
  const result: CatalogModel[] = []
  for (const model of body.models) {
    if (!object(model) || !['list', 'hide'].includes(String(model.visibility))) throw new CatalogError('catalog-invalid')
    if (model.visibility !== 'list') continue
    if (typeof model.slug !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(model.slug) || seen.has(model.slug)
      || typeof model.display_name !== 'string' || !model.display_name.trim() || model.display_name.length > 200
      || !Number.isSafeInteger(model.context_window) || Number(model.context_window) <= 0
      || !Array.isArray(model.input_modalities) || !model.input_modalities.includes('text')
      || model.input_modalities.some(v => v !== 'text' && v !== 'image')
      || !Array.isArray(model.supported_reasoning_levels)) throw new CatalogError('catalog-invalid')
    seen.add(model.slug)
    const efforts: Record<string, string> = {}
    for (const level of model.supported_reasoning_levels) {
      if (!object(level) || typeof level.effort !== 'string') throw new CatalogError('catalog-invalid')
      // ultra requires Codex-specific delegation; this Harness cannot represent it.
      if (LEVELS.includes(level.effort)) efforts[level.effort] = level.effort
    }
    result.push({ id: model.slug, name: model.display_name, contextWindow: Number(model.context_window),
      input: [...new Set(model.input_modalities)] as ('text' | 'image')[],
      reasoningEfforts: Object.keys(efforts).length ? efforts : false,
      ...(Number.isSafeInteger(model.max_output_tokens) && Number(model.max_output_tokens) > 0 ? { maxTokens: Number(model.max_output_tokens) } : {}),
    })
  }
  if (!result.length) throw new CatalogError('catalog-empty')
  return result
}
export async function fetchCatalog(access: string, accountId: string, signal: AbortSignal, request: typeof fetch = fetch): Promise<CatalogModel[]> {
  const response = await request(CATALOG_URL, { method: 'GET', signal, redirect: 'error', cache: 'no-store',
    headers: { Authorization: `Bearer ${access}`, 'ChatGPT-Account-Id': accountId, originator: 'pi', 'User-Agent': 'dsh-subscription-bridge/0.1.6', Accept: 'application/json' },
  })
  if (!response.ok) { await response.body?.cancel(); throw new CatalogError(response.status === 401 || response.status === 403 ? 'catalog-auth' : 'catalog-network') }
  // Bound bytes before JSON parsing; never forward remote response bodies as errors.
  const reader = response.body?.getReader()
  if (!reader) throw new CatalogError('catalog-invalid')
  let bytes = 0
  const chunks: Uint8Array[] = []
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 1024 * 1024) throw new CatalogError('catalog-invalid'); chunks.push(value) } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  const data = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength }
  try { return parseCatalog(JSON.parse(new TextDecoder().decode(data))) } catch { throw new CatalogError('catalog-invalid') }
}
/** No separate token store. Mirrors the official pi/Harness credential seam. */
function nativeModels(ctx: Context, allowed: () => boolean) {
  const credential = (record: Awaited<ReturnType<typeof ctx.credentials.readRecord>>): Credential | undefined => {
    if (record?.kind !== 'grant' || !object(record.payload) || record.payload.type !== 'oauth') return undefined
    return record.payload as unknown as Credential
  }
  const models = createModels({ credentials: {
    read: async id => id === 'openai-codex' && allowed() ? credential(await ctx.credentials.readRecord(KEY)) : undefined,
    list: async () => [],
    modify: async (id, mutate) => {
      if (id !== 'openai-codex' || !allowed()) throw new CatalogError('catalog-auth')
      const stored = await ctx.credentials.modifyRecord(KEY, async current => {
        if (!allowed() || !credential(current)) throw new CatalogError('catalog-auth')
        const next = await mutate(credential(current))
        if (!allowed()) throw new CatalogError('catalog-auth')
        if (!next) return undefined
        if (next.type !== 'oauth') throw new CatalogError('catalog-auth')
        return { kind: 'grant', payload: JSON.parse(JSON.stringify(next)) }
      })
      return credential(stored)
    },
    delete: async () => { throw new CatalogError('catalog-auth') },
  } })
  models.setProvider(openaiCodexProvider())
  return models
}
export class CodexCatalog {
  status: CatalogStatus = { state: 'idle' }
  private inflight?: Promise<CatalogStatus>
  private readonly lifetime = new AbortController()
  private generation = 0
  private readonly auth
  constructor(private readonly ctx: Context, private readonly allowed: () => boolean, private readonly route: () => {
    entry: { settingsNs: string; settingsPath: readonly string[] }; settings: { revision: number }; profile: unknown; keyReference: boolean
  }, private readonly request: typeof fetch = fetch) { this.auth = nativeModels(ctx, allowed) }
  refresh(): Promise<CatalogStatus> {
    if (this.inflight) return this.inflight
    const operation = this.run().finally(() => { if (this.inflight === operation) this.inflight = undefined })
    this.inflight = operation
    return operation
  }
  invalidate(): void { this.generation++; this.status = { state: 'idle' } }
  async dispose(): Promise<void> { this.generation++; this.lifetime.abort(); await this.inflight }
  async settle(): Promise<void> { await this.inflight }
  private async run(): Promise<CatalogStatus> {
    const generation = this.generation
    const previous = this.status
    try {
      if (!this.allowed() || this.lifetime.signal.aborted) throw new CatalogError('catalog-auth')
      const info = await this.ctx.credentials.describeRecord(KEY)
      if (!info.configured || info.kind !== 'grant') return this.status = { state: 'skipped' }
      const initial = this.route()
      if (initial.profile === undefined) return this.status = { state: 'skipped' }
      if (initial.keyReference || !object(initial.profile) || initial.profile.baseURL || initial.profile.api
        || (initial.profile.modelOverrides !== undefined && (!object(initial.profile.modelOverrides) || Object.keys(initial.profile.modelOverrides).length > 0))) throw new CatalogError('catalog-custom-route')
      this.status = { ...previous, state: 'loading' }
      const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(10000)])
      const auth = await this.auth.getAuth('openai-codex', { signal })
      const stored = await this.ctx.credentials.readRecord(KEY)
      const payload = stored?.kind === 'grant' && object(stored.payload) ? stored.payload : undefined
      if (!auth?.auth.apiKey || !payload || payload.access !== auth.auth.apiKey || typeof payload.accountId !== 'string') throw new CatalogError('catalog-auth')
      const models = await fetchCatalog(auth.auth.apiKey, payload.accountId, signal, this.request)
      signal.throwIfAborted()
      if (!this.allowed() || generation !== this.generation) throw new CatalogError('catalog-auth')
      // Fence account switches/logouts during network access and retain user route changes.
      const current = await this.ctx.credentials.readRecord(KEY)
      if (current?.kind !== 'grant' || !object(current.payload) || current.payload.accountId !== payload.accountId || current.payload.access !== payload.access) throw new CatalogError('catalog-auth')
      const next = this.route()
      if (JSON.stringify(next.profile) !== JSON.stringify(initial.profile) || next.keyReference) throw new CatalogError('catalog-conflict')
      if (JSON.stringify((next.profile as Record<string, unknown>).models) !== JSON.stringify(models)) {
        await this.ctx.settings.mutate(next.entry.settingsNs, [{ op: 'set', path: [...next.entry.settingsPath, 'models'], value: models }], next.settings.revision)
      }
      return this.status = { state: 'fresh', refreshedAt: new Date().toISOString(), count: models.length }
    } catch (error) {
      const code = error instanceof CatalogError ? error.message : 'catalog-network'
      if (generation !== this.generation) return { state: 'stale', error: code }
      return this.status = { ...previous, state: 'stale', error: code }
    }
  }
}
