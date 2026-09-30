import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseCatalog, fetchCatalog, CodexCatalog, CATALOG_URL } from '../lib/catalog.js'
import { installCatalogRefresh } from '../lib/client/catalog-refresh.js'
import { inject as clientGrants } from '../lib/client/index.js'

const KEY = 'llm-pi-ai/openai-codex'
const row = (slug = 'gpt-new-release') => ({ slug, display_name: 'New model', visibility: 'list', context_window: 272000, input_modalities: ['text', 'image'], supported_reasoning_levels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(effort => ({ effort })), base_instructions: 'must never be imported' })
const response = models => Response.json({ models })
test('remote metadata is the only source; filtering, ordering and compatible efforts', () => {
  const models = parseCatalog({ models: [row('gpt-6.1-sol'), { ...row('hidden'), visibility: 'hide' }, row('future-model')] })
  assert.deepEqual(models.map(m => m.id), ['gpt-6.1-sol', 'future-model'])
  assert.deepEqual(Object.keys(models[0].reasoningEfforts), ['low', 'medium', 'high', 'xhigh', 'max'])
  assert(!JSON.stringify(models).includes('base_instructions'))
  assert.equal(models[0].maxTokens, undefined)
  for (const models of [[], [row(), row()], [{ ...row(), context_window: 0 }], [{ ...row(), input_modalities: ['video'] }], [{ ...row(), slug: 'unsafe/id' }]]) assert.throws(() => parseCatalog({ models }), /catalog-/)
})
test('fetch uses fixed official endpoint, no redirects/cache and bounded response/errors', async () => {
  await fetchCatalog('synthetic-access', 'synthetic-account', AbortSignal.timeout(1000), async (url, init) => {
    assert.equal(url, CATALOG_URL); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store')
    assert.equal(init.headers.Authorization, 'Bearer synthetic-access'); assert.equal(init.headers['ChatGPT-Account-Id'], 'synthetic-account')
    return response([row()])
  })
  for (const status of [401, 403, 429, 500]) await assert.rejects(fetchCatalog('token', 'account', AbortSignal.timeout(1000), async () => new Response('echo-secret', { status })), error => !error.message.includes('echo-secret') && error.message.startsWith('catalog-'))
  await assert.rejects(fetchCatalog('token', 'account', AbortSignal.timeout(1000), async () => new Response('x'.repeat(1024 * 1024 + 1))), /catalog-invalid/)
  await assert.rejects(fetchCatalog('token', 'account', AbortSignal.timeout(1000), async () => Response.json({ models: [] })), /catalog-invalid/)
})
async function harness(request, profile = { transport: 'sse' }) {
  const ctx = new Context()
  await ctx.plugin(LocalCredentials, { path: join(await mkdtemp(join(tmpdir(), 'dsh-catalog-')), 'credentials.yaml'), watch: false })
  await ctx.credentials.modifyRecord(KEY, async () => ({ kind: 'grant', payload: { type: 'oauth', access: 'synthetic-access', refresh: 'synthetic-refresh', accountId: 'synthetic-account', expires: Date.now() + 3600000 } }))
  let revision = 1
  const writes = []
  const native = { profile }
  ctx.provide('settings', { mutate: async (ns, ops, rev) => {
    assert.equal(ns, 'native-ns'); assert.equal(rev, revision)
    assert.deepEqual(ops[0].path, ['providers', 'openai-codex', 'models'])
    native.profile = { ...native.profile, models: ops[0].value }; revision++; writes.push(ops)
  } })
  let allowed = true
  const catalog = new CodexCatalog(ctx, () => allowed, () => ({ entry: { settingsNs: 'native-ns', settingsPath: ['providers', 'openai-codex'] }, settings: { revision }, profile: native.profile, keyReference: !!native.profile?.apiKeyEnv }), request)
  return { ctx, catalog, writes, native, revoke: () => { allowed = false; catalog.invalidate() } }
}
test('each explicit refresh goes online, concurrent reads coalesce, unchanged results do not rewrite', async () => {
  let calls = 0
  const { ctx, catalog, writes, native } = await harness(async () => { calls++; await new Promise(r => setTimeout(r, 10)); return response([row()]) })
  assert.deepEqual(await Promise.all([catalog.refresh(), catalog.refresh()]), [catalog.status, catalog.status])
  assert.equal(calls, 1); assert.equal(writes.length, 1); assert.equal(native.profile.transport, 'sse')
  assert.equal((await catalog.refresh()).state, 'fresh'); assert.equal(calls, 2); assert.equal(writes.length, 1)
  assert(!JSON.stringify(catalog.status).includes('synthetic'))
  await catalog.dispose(); await ctx.fiber.dispose()
})
test('network/malformed/empty failure leaves previous route and reports stale without secret diagnostics', async () => {
  let fail = false
  const { ctx, catalog, native, writes } = await harness(async () => { if (fail) throw new Error('synthetic-secret'); return response([row()]) })
  await catalog.refresh(); const previous = structuredClone(native.profile); const refreshedAt = catalog.status.refreshedAt
  fail = true
  assert.equal((await catalog.refresh()).state, 'stale'); assert.equal(catalog.status.refreshedAt, refreshedAt)
  assert.deepEqual(native.profile, previous); assert.equal(writes.length, 1); assert(!JSON.stringify(catalog.status).includes('synthetic-secret'))
  await catalog.dispose(); await ctx.fiber.dispose()
})
test('custom endpoint/API-key reference/overrides are refused before credential resolution or network', async () => {
  for (const profile of [{ baseURL: 'https://elsewhere.example' }, { api: 'openai-completions' }, { apiKeyEnv: 'EXISTING_KEY' }, { modelOverrides: { custom: {} } }]) {
    const { ctx, catalog, writes, native } = await harness(async () => { assert.fail('must not send grant') }, profile)
    assert.equal((await catalog.refresh()).error, 'catalog-custom-route'); assert.equal(writes.length, 0); assert.deepEqual(native.profile, profile)
    await catalog.dispose(); await ctx.fiber.dispose()
  }
})
test('logout/account switch and config changes during fetch prevent stale route commits', async () => {
  for (const change of ['logout', 'account', 'config']) {
    let release, started
    const gate = new Promise(r => release = r); const arrived = new Promise(r => started = r)
    const h = await harness(async () => { started(); await gate; return response([row()]) })
    const operation = h.catalog.refresh(); await arrived
    if (change === 'logout') h.revoke()
    if (change === 'account') await h.ctx.credentials.modifyRecord(KEY, async record => ({ ...record, payload: { ...record.payload, accountId: 'other-account' } }))
    if (change === 'config') h.native.profile = { transport: 'websocket' }
    release(); assert.equal((await operation).state, 'stale'); assert.equal(h.writes.length, 0)
    await h.catalog.dispose(); await h.ctx.fiber.dispose()
  }
})
test('API-key records are never used for subscription catalog access', async () => {
  const { ctx, catalog, writes } = await harness(async () => { assert.fail('must not fetch') })
  await ctx.credentials.modifyRecord(KEY, async () => ({ kind: 'api-key', key: 'do-not-use' }))
  assert.equal((await catalog.refresh()).state, 'skipped'); assert.equal(writes.length, 0)
  assert.equal((await ctx.credentials.readRecord(KEY)).key, 'do-not-use')
  await catalog.dispose(); await ctx.fiber.dispose()
})
test('native pi refresh uses the Harness credential transaction, not another token store', async () => {
  const h = await harness(async (url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer ' + refreshedAccess)
    return response([row()])
  })
  const refreshedAccess = ['synthetic', Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-account' } })).toString('base64url'), 'synthetic'].join('.')
  await h.ctx.credentials.modifyRecord(KEY, async record => ({ ...record, payload: { ...record.payload, expires: Date.now() - 1 } }))
  const originalFetch = globalThis.fetch
  let rotations = 0
  globalThis.fetch = async url => {
    assert.equal(String(url), 'https://auth.openai.com/oauth/token'); rotations++
    return Response.json({ access_token: refreshedAccess, refresh_token: 'synthetic-rotated-refresh', expires_in: 3600 })
  }
  try {
    assert.equal((await h.catalog.refresh()).state, 'fresh')
    const stored = await h.ctx.credentials.readRecord(KEY)
    assert.equal(rotations, 1); assert.equal(stored.payload.refresh, 'synthetic-rotated-refresh')
    assert.equal(stored.payload.access, refreshedAccess); assert(stored.payload.expires > Date.now())
  } finally { globalThis.fetch = originalFetch; await h.catalog.dispose(); await h.ctx.fiber.dispose() }
})
test('client declares native service grants needed by Cordis traced picker methods', () => {
  for (const service of ['modelDirectories', 'sessions', 'remote', 'remote.session']) assert(clientGrants.includes(service))
})
function clientHarness() {
  let state = { status: 'ready', error: null, failures: [], groups: [{ id: 'openai-codex', models: [{ id: 'existing' }] }] }
  let nativeLoads = 0, catalogLoads = 0, online = 0, fail = false
  const directory = { store: { update: fn => fn(state), getSnapshot: () => state }, catalog: { refresh: () => catalogLoads++ }, load: async () => { nativeLoads++; state.status = 'ready'; state.error = null; return state } }
  const resolver = { directoryFor: () => directory }
  const api = { refreshCatalog: async () => { online++; await new Promise(r => setTimeout(r, 10)); return { state: fail ? 'stale' : 'fresh' } } }
  return { resolver, directory, api, counts: () => ({ nativeLoads, catalogLoads, online }), fail: () => fail = true }
}
test('native picker load fetches every opening; fallback stays visible and methods restore on unload', async () => {
  const h = clientHarness(); const originalFor = h.resolver.directoryFor, originalLoad = h.directory.load
  const dispose = installCatalogRefresh(h.resolver, h.api, 'previous catalog', 'unsupported')
  const directory = h.resolver.directoryFor('session')
  await Promise.all([directory.load(), directory.load()]); await directory.load()
  assert.deepEqual(h.counts(), { nativeLoads: 2, catalogLoads: 2, online: 2 })
  h.fail(); const state = await directory.load()
  assert.equal(state.error, 'previous catalog'); assert.equal(state.groups[0].models[0].id, 'existing'); assert.equal(state.failures[0].id, 'openai-codex')
  dispose(); assert.equal(h.resolver.directoryFor, originalFor); assert.equal(directory.load, originalLoad)
})
test('unsupported native integration fails visibly without crashing normal directory loading', async () => {
  const h = clientHarness(); delete h.directory.catalog
  const dispose = installCatalogRefresh(h.resolver, h.api, 'stale', 'unsupported')
  assert.equal((await h.resolver.directoryFor('session').load()).error, 'unsupported')
  assert.equal(h.counts().online, 0); dispose()
})
