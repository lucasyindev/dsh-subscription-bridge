import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import Authorization from '@deepseek-ai/dsh-authorization'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { SubscriptionBridge, apply, RPC_PREFIX, RPC_CHANNEL } from '../lib/index.js'
import { safeLoginUrl } from '../lib/client/Section.js'
import * as Connection from '@deepseek-ai/dsh-client-connection'

const KEY = credentialKey('llm-pi-ai', 'openai-codex')
const tick = () => new Promise(resolve => setImmediate(resolve))
async function waitFor(read, predicate) { for (let i = 0; i < 200; i++) { const value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 5)) } throw new Error('Timed out') }
async function harness(run, options = {}) {
  const path = join(await mkdtemp(join(tmpdir(), 'dsh-bridge-')), '.credentials.yaml')
  const ctx = new Context()
  await ctx.plugin(LocalCredentials, { path, watch: false })
  await ctx.plugin(Authorization)
  const profiles = options.profiles ?? {}
  const writes = []
  ctx.provide('llm', {
    listProviders: () => Object.keys(profiles).map(id => ({ id, name: id })),
    listConfigurableProviders: () => [{ provider: 'openai-codex', settingsNs: 'native-custom-id', settingsPath: ['providers', 'openai-codex'] }],
  })
  ctx.provide('settings', {
    describe: () => [{ ns: 'native-custom-id', revision: 3, value: { providers: profiles } }],
    mutate: async (ns, ops, revision) => { if (options.conflict) throw new Error('conflict'); writes.push({ ns, ops, revision }); profiles['openai-codex'] = ops[0].value },
  })
  ctx.authorization.registerFlow({ key: KEY, label: 'ChatGPT', methods: [{ id: 'oauth', label: 'Connect' }], run })
  const bridge = new SubscriptionBridge(ctx)
  return { ctx, bridge, path, writes }
}
const first = bridge => bridge.list().then(rows => rows[0])

test('real authorization and file store commit; native route enable uses directory namespace and revision', async () => {
  const { bridge, path, writes } = await harness(async session => { session.notify({ message: 'Sign in', url: 'https://example.com/oauth', code: 'ABCD' }); session.notify({ message: 'Waiting for confirmation' }); const answer = await session.prompt({ kind: 'secret', message: 'Code' }); assert.equal(answer, 'synthetic-code'); await session.commit({ kind: 'grant', payload: { access: 'synthetic-token' } }) })
  bridge.begin(KEY)
  assert.throws(() => bridge.begin(KEY), /busy/)
  const view = await waitFor(() => first(bridge), row => row.prompts.length > 0)
  assert.equal(view.notice.code, 'ABCD')
  assert(!JSON.stringify(view).includes('synthetic-token'))
  bridge.answer(KEY, view.prompts[0].id, 'synthetic-code')
  await waitFor(() => first(bridge), row => row.outcome === 'authorized')
  assert.equal(writes.length, 1)
  assert.equal(writes[0].ns, 'native-custom-id')
  assert.equal(writes[0].revision, 3)
  assert((await readFile(path, 'utf8')).includes('synthetic-token'))
  assert.equal((await stat(path)).mode & 0o777, 0o600)
  const final = await first(bridge)
  assert.equal(final.credential.kind, 'grant')
  assert.equal(final.prompts.length, 0)
  assert.equal(final.notice, undefined)
  assert(!JSON.stringify(final).includes('synthetic-token'))
  await bridge.signOut(KEY)
  assert.equal((await first(bridge)).credential.configured, false)
  assert.equal((await first(bridge)).enabled, true)
  await bridge.dispose()
})

test('select answers validate offered options; stale and cross-flow prompt ids cannot answer', async () => {
  const { bridge } = await harness(async session => { const result = await session.prompt({ kind: 'select', message: 'Account', options: [{ id: 'one', label: 'One' }] }); assert.equal(result, 'one'); await session.commit({ kind: 'grant', payload: {} }) })
  bridge.begin(KEY)
  const view = await waitFor(() => first(bridge), row => row.prompts.length > 0)
  const id = view.prompts[0].id
  assert.throws(() => bridge.answer(KEY, id, 'two'), /invalid-option/)
  assert.throws(() => bridge.answer(KEY, 'stale', 'one'), /stale-prompt/)
  bridge.answer(KEY, id, 'one')
  assert.throws(() => bridge.answer(KEY, id, 'one'), /stale-prompt/)
  await waitFor(() => first(bridge), row => row.outcome === 'authorized')
  await bridge.dispose()
})

test('concurrent prompts and individual withdrawal do not cancel the remaining flow', async () => {
  const withdrawal = new AbortController()
  const { bridge } = await harness(async session => {
    const losing = session.prompt({ kind: 'text', message: 'Losing callback', signal: withdrawal.signal }).catch(() => undefined)
    const winning = session.prompt({ kind: 'text', message: 'Winning callback' })
    await winning; withdrawal.abort(); await losing
    await session.commit({ kind: 'grant', payload: {} })
  })
  bridge.begin(KEY)
  const view = await waitFor(() => first(bridge), row => row.prompts.length === 2)
  bridge.answer(KEY, view.prompts.find(prompt => prompt.prompt.message === 'Winning callback').id, 'callback')
  await waitFor(() => first(bridge), row => row.outcome === 'authorized')
  await bridge.dispose()
})

test('cancel and unload withdraw prompts without storing a grant', async () => {
  const { bridge } = await harness(async session => { await session.prompt({ kind: 'text', message: 'Callback' }); await session.commit({ kind: 'grant', payload: {} }) })
  bridge.begin(KEY)
  await waitFor(() => first(bridge), row => row.prompts.length > 0)
  bridge.cancel(KEY)
  await waitFor(() => first(bridge), row => row.outcome === 'cancelled')
  assert.equal((await first(bridge)).credential.configured, false)
  bridge.begin(KEY)
  await waitFor(() => first(bridge), row => row.prompts.length > 0)
  await bridge.dispose()
  assert.equal((await first(bridge)).credential.configured, false)
})

test('logout waits for admitted native commit and leaves no resurrected grant', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const { ctx, bridge } = await harness(async session => { await session.commit({ kind: 'grant', payload: { temporary: true } }); await gate })
  bridge.begin(KEY)
  await waitFor(() => ctx.credentials.describeRecord(KEY), info => info.configured)
  const deleting = bridge.signOut(KEY)
  assert.throws(() => bridge.begin(KEY), /busy/)
  release(); await deleting; await tick()
  assert.equal((await first(bridge)).credential.configured, false)
  await bridge.dispose()
})

test('existing profile and API-key references are preserved', async () => {
  const profiles = { 'openai-codex': { apiKeyEnv: 'EXISTING_KEY', transport: 'sse' }, other: { baseURL: 'https://example.com' } }
  const original = JSON.stringify(profiles)
  const { bridge, writes } = await harness(async session => session.commit({ kind: 'grant', payload: {} }), { profiles })
  bridge.begin(KEY)
  await waitFor(() => first(bridge), row => row.outcome === 'enable-failed')
  assert.equal(JSON.stringify(profiles), original)
  assert.equal(writes.length, 0)
  await assert.rejects(bridge.enable(KEY), /api-key-reference/)
  assert.equal((await first(bridge)).keyReference, true)
  await bridge.dispose()
})

test('existing API-key record is never overwritten or deleted', async () => {
  let called = false
  const { ctx, bridge } = await harness(async () => { called = true })
  await ctx.credentials.modifyRecord(KEY, async () => ({ kind: 'api-key', key: 'synthetic-api-key' }))
  bridge.begin(KEY)
  await waitFor(() => first(bridge), row => row.outcome === 'failed')
  assert.equal(called, false)
  await assert.rejects(bridge.signOut(KEY), /not-grant/)
  assert.equal((await ctx.credentials.readRecord(KEY)).key, 'synthetic-api-key')
  await bridge.dispose()
})

test('failing route activation does not misreport or roll back successful native login', async () => {
  const { bridge } = await harness(async session => session.commit({ kind: 'grant', payload: {} }), { conflict: true })
  bridge.begin(KEY)
  const row = await waitFor(() => first(bridge), row => row.outcome === 'enable-failed')
  assert.equal(row.credential.configured, true)
  assert.equal(row.enabled, false)
  await bridge.dispose()
})

test('native discovery filters unsupported scopes and API-key-only methods', async () => {
  const { ctx, bridge } = await harness(async () => {})
  ctx.authorization.registerFlow({ key: credentialKey('other-plugin', 'openai-codex'), label: 'Other', methods: [{ id: 'oauth', label: 'Other' }], run: async () => {} })
  ctx.authorization.registerFlow({ key: credentialKey('llm-pi-ai', 'api-only'), label: 'Key', methods: [{ id: 'api-key', label: 'Key' }], run: async () => {} })
  assert.equal((await bridge.list()).length, 1)
  assert.throws(() => bridge.begin('other-plugin/openai-codex'), /invalid-flow/)
  assert.throws(() => bridge.begin('llm-pi-ai/missing'), /unsupported-flow/)
  await bridge.dispose()
})

test('exact official routes reject malformed input without touching the Gateway interceptor', async () => {
  const { ctx } = await harness(async () => { throw new Error('synthetic-secret-token') })
  const routes = new Map()
  ctx.provide('connection', { rpc: { intercept() { assert.fail('The /api interceptor belongs exclusively to the official Gateway') }, handle() { assert.fail('Use exact routes, not a new physical transport') } }, fetch: { register(route) { assert(route.path.startsWith(`${RPC_CHANNEL}/${RPC_PREFIX}`)); routes.set(route.path, route); return async () => {} } } })
  apply(ctx)
  assert.equal(routes.size, 7)
  const handler = async (endpoint, payload) => {
    const route = routes.get(`${RPC_CHANNEL}/${endpoint}`)
    if (!route) return { ok: false }
    const response = await route.fetch(new Request(`http://localhost${route.path}`, { method: 'POST', body: JSON.stringify({ type: 'client-request', rpcId: 'route-test', method: endpoint, payload }) }))
    return (await response.json()).result
  }
  assert.equal((await handler(`${RPC_PREFIX}list`, {})).ok, true)
  assert.equal((await handler(`${RPC_PREFIX}missing`, {})).ok, false)
  assert.equal((await handler('other.list', {})).ok, false)
  assert.equal((await handler(`${RPC_PREFIX}begin`, { key: 3 })).ok, false)
  assert.equal((await handler(`${RPC_PREFIX}begin`, { key: KEY })).ok, true)
  await tick(); await tick()
  const response = await handler(`${RPC_PREFIX}list`, {})
  assert(!JSON.stringify(response).includes('synthetic-secret-token'))
  assert.equal(response.value[0].outcome, 'failed')
})

test('authorization links reject dangerous schemes and credential-bearing URLs', () => {
  assert.equal(safeLoginUrl('javascript:alert(1)'), undefined)
  assert.equal(safeLoginUrl('https://user:pass@example.com'), undefined)
  assert.equal(safeLoginUrl('http://example.com'), undefined)
  assert.equal(safeLoginUrl('https://example.com/oauth?code=short'), 'https://example.com/oauth?code=short')
})

test('real official Connection retains Gateway ownership while serving all bridge routes', async () => {
  const { ctx } = await harness(async () => {})
  const routes = []
  ctx.provide('webServer', { port: 0, register(route) { routes.push(route); return () => {} }, tapIndex() { return () => {} } })
  const fiber = ctx.plugin(Connection)
  await fiber.await()
  const connection = ctx.get('connection')
  connection.rpc.intercept('/api', endpoint => endpoint === 'settings/describe', async () => ({ ok: true, value: 'official-gateway-still-owns-api' }))
  apply(ctx)
  const shared = connection.createSharedFetchHandler('/api')
  async function post(method, payload, wireMethod = method) {
    return shared.fetch(new Request(`http://127.0.0.1/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'coexistence', method: wireMethod, payload }) }))
  }
  assert.equal((await (await post('settings/describe', {})).json()).result.value, 'official-gateway-still-owns-api')
  assert.equal((await (await post(`${RPC_PREFIX}list`, {})).json()).result.ok, true)
  assert.equal((await post(`${RPC_PREFIX}list`, {}, 'other/method')).status, 400)
  assert.equal((await shared.fetch(new Request(`http://127.0.0.1/api/${RPC_PREFIX}list`, { method: 'POST', body: 'not-json' }))).status, 400)
  assert.equal((await shared.fetch(new Request('http://127.0.0.1/api/unowned/method', { method: 'POST', body: '{}' }))).status, 404)
  assert.throws(() => connection.rpc.intercept('/api', () => true, async () => ({ ok: true, value: null })), /already has an interceptor/)
  await ctx.fiber.dispose()
})
