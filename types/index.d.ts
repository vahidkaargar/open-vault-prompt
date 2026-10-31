export type VaultView = {
  id: string
  name: string
  project: string
  reason: string
  /** Bullets standing for the typed value; the value itself is never in state. */
  shown: string
  phase: 'input' | 'saving'
  isOverwrite: boolean
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    'open-vault-prompt': { view: VaultView | null }
  }
}
