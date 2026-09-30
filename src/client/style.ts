/** Scoped settings chrome, following official ModelsSection and ui-primitives/Button.
 * Host font, semantic theme tokens and radius scale remain the source of truth. */
export const css = `
.subscription-bridge { font: inherit; color: var(--dsw-alias-label-primary); max-width: 720px; }
.subscription-bridge h2 { font-size: 16px; line-height: 24px; font-weight: 500; margin: 0 0 8px; }
.subscription-bridge p { font-size: 14px; line-height: 22px; margin: 8px 0 0; overflow-wrap: anywhere; }
.subscription-bridge .sb-intro, .subscription-bridge .sb-note { color: var(--dsw-alias-label-secondary); }
.subscription-bridge .sb-intro { margin: 0; }
.subscription-bridge .sb-note { margin-top: 16px; font-size: 12px; line-height: 18px; }
.subscription-bridge .sb-providers { margin-top: 16px; container-type: inline-size; }
.subscription-bridge .sb-row { padding: 12px 0; border-bottom: .5px solid var(--dsw-alias-border-l2); }
.subscription-bridge .sb-row:last-child { border-bottom: none; }
.subscription-bridge .sb-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.subscription-bridge .sb-identity { min-width: 0; }
.subscription-bridge h3 { font-size: 14px; line-height: 22px; font-weight: 500; margin: 0; overflow-wrap: anywhere; }
.subscription-bridge .sb-status { font-size: 12px; line-height: 18px; margin-top: 2px; color: var(--dsw-alias-label-secondary); }
.subscription-bridge .sb-actions { display: flex; flex: none; flex-wrap: wrap; justify-content: flex-end; gap: 4px; }
.subscription-bridge button, .subscription-bridge .sb-link { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; font: inherit; font-size: 14px; line-height: 22px; min-height: 36px; padding: 6px 14px; border-radius: var(--dsw-radius-md); border: .5px solid var(--dsw-alias-border-l3); background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; }
.subscription-bridge .sb-actions button { min-height: 28px; padding: 4px 10px; font-size: 12px; line-height: 18px; border-radius: var(--dsw-radius-sm); }
.subscription-bridge .sb-primary { border-color: transparent; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }
.subscription-bridge button:disabled { opacity: .4; cursor: not-allowed; }
.subscription-bridge button:not(:disabled):hover, .subscription-bridge .sb-link:hover { background: var(--dsw-alias-interactive-bg-hover); }
.subscription-bridge .sb-primary:not(:disabled):hover { background: var(--dsw-alias-button-primary-hover); }
.subscription-bridge .sb-forget { border-color: transparent; color: var(--dsw-alias-label-secondary); }
.subscription-bridge :focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
.subscription-bridge ::selection { background: var(--dsw-alias-interactive-bg-active); color: var(--dsw-alias-label-primary); }
.subscription-bridge .sb-link { text-underline-offset: 3px; }
.subscription-bridge .sb-notice, .subscription-bridge .sb-prompt { margin-top: 12px; padding: 12px 14px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-module-platform); }
.subscription-bridge .sb-notice p:first-child { margin-top: 0; }
.subscription-bridge .sb-notice .sb-link { margin-top: 8px; }
.subscription-bridge .sb-prompt { display: grid; gap: 12px; }
.subscription-bridge .sb-prompt label { display: grid; gap: 8px; font-size: 14px; line-height: 22px; }
.subscription-bridge input, .subscription-bridge select { font: inherit; font-size: 14px; line-height: 22px; width: 100%; box-sizing: border-box; min-height: 36px; border: .5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-sm); padding: 6px 10px; background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary); caret-color: var(--dsw-alias-label-primary); }
.subscription-bridge input::placeholder { color: var(--dsw-alias-label-secondary); opacity: 1; }
.subscription-bridge code { font-size: 14px; font-variant-numeric: tabular-nums; user-select: all; }
.subscription-bridge [role="alert"] { color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 92%, var(--dsw-alias-label-primary)); }
.subscription-bridge .sb-unavailable { margin-top: 16px; }
.subscription-bridge .sb-unavailable button { margin-top: 8px; }
@container (max-width: 360px) { .subscription-bridge .sb-heading { align-items: flex-start; flex-direction: column; gap: 8px; } }
@media (max-width: 520px) { .subscription-bridge .sb-heading { align-items: flex-start; flex-direction: column; gap: 8px; } }
`
