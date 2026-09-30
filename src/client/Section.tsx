import { useEffect, useRef, useState } from 'react'
import type { BridgeApi, FlowView, PromptView } from '../types.js'
import type { CopyKey } from './locales.js'
type Translate = (key: CopyKey) => string
export interface SectionProps { api: BridgeApi; t: Translate }
/** Allow only normal external HTTPS authorization pages, never arbitrary schemes. */
export function safeLoginUrl(raw?: string): string | undefined {
  if (!raw) return undefined
  try { const url = new URL(raw); if (url.protocol === 'https:' && !url.username && !url.password) return url.href } catch { /* No link is safer than interpreting invalid flow output. */ }
  return undefined
}
function Prompt({ item, busy, t, answer }: { item: PromptView; busy: boolean; t: Translate; answer(value: string): Promise<void> }) {
  const [value, setValue] = useState('')
  return <form className="sb-prompt" onSubmit={event => { event.preventDefault(); const sent = value; setValue(''); void answer(sent) }}>
    <label>{item.prompt.message}{item.prompt.kind === 'select'
      ? <select value={value} onChange={event => setValue(event.target.value)} disabled={busy} required><option value="">{t('choose')}</option>{item.prompt.options.map(option => <option key={option.id} value={option.id}>{option.label}{option.description ? ` — ${option.description}` : ''}</option>)}</select>
      : <input type={item.prompt.kind === 'secret' ? 'password' : 'text'} value={value} onChange={event => setValue(event.target.value)} placeholder={item.prompt.placeholder} autoComplete="off" spellCheck={false} disabled={busy} required />}</label>
    <div><button className="sb-primary" disabled={busy || value.length === 0} type="submit">{t('submit')}</button></div>
  </form>
}
function Flow({ flow, api, t, refresh, unavailable }: { flow: FlowView; api: BridgeApi; t: Translate; refresh(): Promise<void>; unavailable: boolean }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  async function action(name: Parameters<BridgeApi['action']>[0], fields: Record<string, string> = {}) {
    if (pending) return
    setPending(true); setError(undefined)
    try { await api.action(name, { key: flow.key, ...fields }); await refresh() }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'operation-failed') }
    finally { setPending(false) }
  }
  const connected = flow.credential.configured && flow.credential.kind === 'grant'
  const apiKey = flow.credential.configured && flow.credential.kind !== 'grant'
  const link = safeLoginUrl(flow.notice?.url)
  const disabled = pending || unavailable
  const errorKeys: Record<string, CopyKey> = { busy: 'busy-error', 'stale-prompt': 'stale-prompt', 'invalid-option': 'invalid-option', 'not-grant': 'not-grant', 'api-key-reference': 'api-key-reference', 'not-owned': 'not-owned', 'not-connected': 'not-connected' }
  return <section className="sb-row" aria-label={flow.label}>
    <div className="sb-heading"><div className="sb-identity"><h3>{flow.label}</h3>
      <p className="sb-status" role={flow.inFlight ? 'status' : undefined}>{t(flow.inFlight ? 'busy' : connected ? 'connected' : apiKey ? 'apiKey' : 'disconnected')}{connected && <> · {t(flow.enabled ? 'active' : 'inactive')}</>}</p>
    </div><div className="sb-actions">
      {flow.inFlight ? <button disabled={disabled} onClick={() => void action('cancel')}>{t('cancel')}</button>
        : connected ? <>
          {!flow.enabled && <button className="sb-primary" disabled={disabled || flow.keyReference} onClick={() => void action('enable')}>{t('enable')}</button>}
          <button className="sb-forget" disabled={disabled || !flow.credential.writable} onClick={() => { if (window.confirm(t('confirm'))) void action('signOut') }}>{t('signOut')}</button>
        </> : <button className="sb-primary" disabled={disabled || apiKey || !flow.credential.writable} onClick={() => void action('begin')}>{t('connect')}</button>}
    </div></div>
    {flow.keyReference && <p>{t('keyReference')}</p>}
    {connected && flow.catalog && <p className="sb-status" role="status">{t(flow.catalog.state === 'fresh' ? 'catalogFresh' : flow.catalog.state === 'loading' ? 'catalogLoading' : flow.catalog.state === 'stale' ? 'catalogStale' : 'catalogAutomatic')}
      {flow.catalog.refreshedAt && <> · {new Date(flow.catalog.refreshedAt).toLocaleTimeString()}</>}</p>}
    {flow.notice && <div className="sb-notice"><p>{flow.notice.message}</p>{link && <a className="sb-link" href={link} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{t('open')}</a>}{flow.notice.code && <p>{t('code')}: <code>{flow.notice.code}</code></p>}</div>}
    {flow.prompts.map(prompt => <Prompt key={prompt.id} item={prompt} busy={disabled} t={t} answer={value => action('answer', { id: prompt.id, value })} />)}
    {flow.outcome && flow.outcome !== 'authorized' && <p role={flow.outcome === 'cancelled' ? 'status' : 'alert'}>{t(flow.outcome === 'enable-failed' ? 'enableFailed' : flow.outcome === 'cancelled' ? 'cancelled' : 'failed')}</p>}
    {error && <p role="alert">{t(errorKeys[error] ?? 'operation-failed')}</p>}
  </section>
}
/** Native settings section. Polling runs only while mounted, and stops on unmount. */
export function SubscriptionSection({ api, t }: SectionProps) {
  const [flows, setFlows] = useState<FlowView[]>()
  const [failed, setFailed] = useState(false)
  const refreshRef = useRef<() => Promise<void>>(async () => {})
  useEffect(() => {
    const lifetime = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let version = 0
    const refresh = async () => {
      const current = ++version
      try { const rows = await api.list(lifetime.signal); if (!lifetime.signal.aborted && current === version) { setFlows(rows); setFailed(false) } }
      catch { if (!lifetime.signal.aborted && current === version) setFailed(true) }
    }
    refreshRef.current = refresh
    const tick = async () => { await refresh(); if (!lifetime.signal.aborted) timer = setTimeout(() => void tick(), 1000) }
    void tick()
    return () => { lifetime.abort(); if (timer !== undefined) clearTimeout(timer); refreshRef.current = async () => {} }
  }, [api])
  return <div className="subscription-bridge"><h2>{t('title')}</h2><p className="sb-intro">{t('intro')}</p>
    {failed && <div className="sb-unavailable" role="alert"><p>{t('unavailable')}</p><button onClick={() => void refreshRef.current()}>{t('retry')}</button></div>}
    {!flows && !failed && <p role="status">{t('loading')}</p>}
    {flows?.length === 0 && <p>{t('empty')}</p>}
    <div className="sb-providers">{flows?.map(flow => <Flow key={flow.key} flow={flow} api={api} t={t} refresh={() => refreshRef.current()} unavailable={failed} />)}</div>
    <p className="sb-note">{t('note')} {t('selectModel')}</p>
  </div>
}
