export type VaultView = {
  id: string
  name: string
  project: string
  reason: string
  /** Bullets standing for the typed value; the value itself is never in state. */
  shown: string
  phase: 'input' | 'saving' | 'done'
  isOverwrite: boolean
  /** Opened by /ovault-test: the result goes to the human, not the model. */
  isSelfTest?: boolean
  /** The self-test's outcome, shown until the human closes it. */
  result?: { ok: boolean; text: string }
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    'open-vault-prompt': { view: VaultView | null }
  }
}
