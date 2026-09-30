import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { BridgeApi, FlowView } from '../types.js'
import { SubscriptionSection } from './Section.js'
import { en, zh, type CopyKey } from './locales.js'
import { css } from './style.js'
export { SubscriptionSection, safeLoginUrl } from './Section.js'
export { en, zh } from './locales.js'
export const inject = ['slots', 'connection', 'locale']
const NS = 'subscription-bridge'
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'subscription-bridge': CopyKey } }
/** Browser calls use the host's authenticated transport, not a direct third-party fetch. */
export function createApi(connection: ConnectionHandle): BridgeApi {
  async function call(endpoint: string, payload: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    const response = await connection.rpc.call('/api', `subscription-bridge.${endpoint}`, payload, signal)
    if (!response.ok) throw new Error(response.error.code)
    return response.value
  }
  return { list: async signal => await call('list', {}, signal) as FlowView[], action: async (action, payload) => { await call(action, payload) } }
}
/** Contribute one settings section; do not modify the shell or normal model picker. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'subscription-bridge: localized copy')
  ctx.effect(() => { const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style); return () => style.remove() }, 'subscription-bridge: scoped host-theme style')
  const api = createApi(ctx.get('connection') as ConnectionHandle)
  const t = ctx.locale.bind(NS) as (key: CopyKey) => string
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'subscription-bridge', order: 15, label: () => t('nav'), inject: () => ({ api, t }) }, SubscriptionSection))
}
