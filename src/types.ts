import type { AuthorizationEntry, AuthorizationNotice, AuthorizationPrompt } from '@deepseek-ai/dsh-authorization/types'

type WithoutSignal<T> = T extends unknown ? Omit<T, 'signal'> : never
/** Prompt answers never appear in this browser-readable snapshot. */
export interface PromptView { id: string; prompt: WithoutSignal<AuthorizationPrompt> }
/** Value-free native flow plus the bridge's transient conversation. */
export interface FlowView extends AuthorizationEntry {
  credential: { configured: boolean; kind?: 'api-key' | 'grant'; writable: boolean }
  enabled: boolean
  keyReference: boolean
  notice?: AuthorizationNotice
  prompts: PromptView[]
  outcome?: 'authorized' | 'cancelled' | 'failed' | 'enable-failed'
}
/** Typed UI operations over the existing authenticated Connection channel. */
export interface BridgeApi {
  list(signal?: AbortSignal): Promise<FlowView[]>
  action(action: 'begin' | 'answer' | 'cancel' | 'signOut' | 'enable', payload: Record<string, string>): Promise<void>
}
