import type { ModelDirectory, ModelDirectoryResolver } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { BridgeApi } from '../types.js'

/** rc.2 compatibility shim: preserve native picker, projection, selection and RPCs.
 * This release exposes directory.load(), but no force-refresh API. Check the
 * catalog refresh capability at runtime and restore every decorated method.
 * No DOM listeners, polling, global Gateway interception or alternate picker.
 */
export function installCatalogRefresh(resolver: ModelDirectoryResolver, api: BridgeApi, staleMessage: string, unsupportedMessage: string): () => void {
  const nativeFor = resolver.directoryFor
  const installed = new Map<ModelDirectory, { load: ModelDirectory['load']; wrapped: ModelDirectory['load'] }>()
  let disposed = false
  const wrappedFor: ModelDirectoryResolver['directoryFor'] = function (id) {
    const directory = nativeFor.call(resolver, id)
    if (installed.has(directory) || disposed) return directory
    const original = directory.load
    const catalog = (directory as unknown as { catalog?: { refresh(): void } }).catalog
    let inflight: ReturnType<ModelDirectory['load']> | undefined
    const wrapped = function (): ReturnType<ModelDirectory['load']> {
      if (inflight) return inflight
      directory.store.update(s => { s.status = 'loading'; s.error = null })
      const operation = (async () => {
        let error: string | undefined
        if (typeof catalog?.refresh !== 'function') error = unsupportedMessage
        else {
          try { const status = await api.refreshCatalog(); if (status.state === 'stale') error = staleMessage }
          catch { error = staleMessage }
          if (!disposed) catalog.refresh()
        }
        if (disposed) return directory.store.getSnapshot()
        await original.call(directory)
        if (error) directory.store.update(s => {
          s.status = 'error'; s.error = error
          s.failures = [...s.failures.filter(f => f.id !== 'openai-codex'), { id: 'openai-codex', name: 'OpenAI Codex', message: error }]
        })
        return directory.store.getSnapshot()
      })().finally(() => { if (inflight === operation) inflight = undefined })
      inflight = operation
      return operation
    }
    directory.load = wrapped
    installed.set(directory, { load: original, wrapped })
    return directory
  }
  resolver.directoryFor = wrappedFor
  return () => {
    disposed = true
    if (resolver.directoryFor === wrappedFor) resolver.directoryFor = nativeFor
    for (const [directory, methods] of installed) if (directory.load === methods.wrapped) directory.load = methods.load
    installed.clear()
  }
}
