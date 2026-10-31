import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { VaultView } from '../types'

const TOOL = 'request_secret'
const FULL_TOOL = 'mcp__open-vault-prompt__request_secret'
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
const view = atom({ plugin: 'open-vault-prompt', key: 'view' } as const, null as VaultView | null)

const text = (t: string) => ({ result: t })

// The typed value lives only here: never in $.state, a tool result or a log line.
let secret = ''

// Runs `ovault` (or $OVAULT_BIN) with the usual install dirs on PATH; args go in as
// positional parameters, never through the shell's parser.
const RUN_OVAULT =
  'PATH="$HOME/.local/bin:$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH" exec "${OVAULT_BIN:-ovault}" "$@"'

function vault($: EngineInterface, args: string[], stdin?: string) {
  return $.process.run(['/bin/sh', '-c', RUN_OVAULT, 'ovault', ...args], { stdin, timeoutMs: 30_000 })
}

function absorb(shown: string) {
  if (shown.length >= secret.length) secret += shown.slice(secret.length)
  else secret = secret.slice(0, shown.length)
}

async function finish($: EngineInterface, message: string) {
  secret = ''
  await update($, view, () => null)
  await $.prompt.submit({ text: message })
}

async function save($: EngineInterface) {
  const v = await read($, view)
  const value = secret.replace(/[\r\n]+$/, '')
  if (!v || v.phase === 'saving' || value === '') return
  await update($, view, cur => (cur ? { ...cur, phase: 'saving' as const, error: undefined } : cur))

  try {
    const have = await vault($, ['project', 'list'])
    if (have.exitCode !== 0) throw new Error(have.stderr || have.stdout)
    const exists = new RegExp(`^\\s+${v.project.replace(/[.]/g, '\\.')}\\s`, 'm').test(have.stdout)
    if (!exists) {
      const made = await vault($, ['project', 'create', v.project])
      if (made.exitCode !== 0) throw new Error(made.stderr || made.stdout)
    }
    const stored = await vault($, ['secret', 'set', v.name, '--project', v.project, '--file', '/dev/stdin'], value)
    if (stored.exitCode !== 0 || !stored.stdout.includes('Encrypted and stored'))
      throw new Error(stored.stderr || stored.stdout || 'no confirmation from ovault')
    await finish(
      $,
      `Secret "${v.name}" is now stored in Open Vault, project "${v.project}"${v.isOverwrite ? ' (replaced the previous version)' : ''}. ` +
        'Its value was never shown to you. Use it only via `ovault secret get ... --raw` piped into a command.',
    )
  } catch (err) {
    const why = String((err as Error).message ?? err).replace(/\s+/g, ' ').slice(0, 200)
    await update($, view, cur => (cur ? { ...cur, phase: 'input' as const, error: `Not stored: ${why}` } : cur))
  }
}

async function cancel($: EngineInterface) {
  const v = await read($, view)
  if (!v) return
  await finish($, `The human cancelled the request for secret "${v.name}" (project "${v.project}"). Nothing was stored. Do not ask again unless they ask.`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    secret = ''
    await update($, view, () => null)
    await $.tool.register({
      name: TOOL,
      description:
        'Ask the human to type a NEW secret (API key, password, token) into a private dialog in their Claude Code window. ' +
        'The value goes straight into their Open Vault and is never shown to you. Use this instead of asking the user to paste a secret in chat. ' +
        'Returns at once; you will get a message when it is stored or cancelled. Read a stored secret later with ' +
        '`ovault secret get NAME --project PROJECT --raw` piped into a command, never printed.',
      inputSchema: {
        type: 'object',
        properties: {
          secret_name: { type: 'string', description: 'Vault key, e.g. STRIPE_API_KEY. Letters, digits, _ . - only.' },
          project: { type: 'string', description: 'Vault project name, e.g. the repo or service.' },
          reason: { type: 'string', description: 'One sentence shown to the human: what the secret is for.' },
        },
        required: ['secret_name', 'project', 'reason'],
      },
      isDeferred: false,
    })

    return next(e)
  })

  on('tool.call', { tool: FULL_TOOL }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const name = String(input.secret_name ?? '')
    const project = String(input.project ?? '')
    const reason = String(input.reason ?? '')
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .slice(0, 200)

    if (!SAFE_NAME.test(name) || !SAFE_NAME.test(project))
      return { deny: 'secret_name and project must be 1-64 characters of letters, digits, _ . - and start with a letter or digit.' }
    if ((await read($, view)) !== null)
      return { deny: 'Another secret request is already waiting on the human. Wait for its result message.' }

    secret = ''
    await update($, view, () => ({
      id: e.tool_use_id,
      name,
      project,
      reason,
      shown: '',
      phase: 'input' as const,
      isOverwrite: false,
    }))
    void $.ui.notify(`Claude asks you to store the secret ${name} (project ${project})`, { title: 'Open Vault' })

    // Tell the human if this overwrites; the dialog redraws when it answers.
    void vault($, ['secret', 'list', '--project', project]).then(async r => {
      const isOverwrite = new RegExp(`^\\s+${name.replace(/[.]/g, '\\.')}\\s`, 'm').test(r.stdout)
      await update($, view, v => (v && v.id === e.tool_use_id ? { ...v, isOverwrite } : v))
    })

    return text(
      `A private dialog is open in the human's Claude Code window asking for ${name} (project ${project}). ` +
        'Do not ask for the value in chat. You will receive a message when it is stored or cancelled; end your turn or do other work until then.',
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await read($, view)
    if (!v || e.props.hasSurvey || e.surface === 'mobile') return next(e)
    const { Box, Text, Input, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="column" marginX={2} marginY={1}>
        <Box>
          <Text bold color="cyan">
            {v.name}
          </Text>
          <Text dimColor>
            {' '}
            {v.project}
            {v.isOverwrite ? ' (new version)' : ''}{' '}
          </Text>
          <Box flexGrow={1}>
            <Input
              key="secret"
              placeholder={v.phase === 'saving' ? 'storing...' : 'paste secret, Enter to store'}
              value={v.shown}
              autoFocus
              submitLabel="store"
              onInput={shown => {
                absorb(shown)
                void update($, view, cur => (cur ? { ...cur, shown: '•'.repeat(secret.length) } : cur))
              }}
              onSubmit={() => void save($)}
            />
          </Box>
          <Button key="store" variant="primary" onPress={() => void save($)}>
            Store
          </Button>
          <Button key="cancel" plain onPress={() => void cancel($)}>
            {' '}✕
          </Button>
        </Box>
        {v.error && <Text color="red">{v.error}</Text>}
      </Box>
    )
  })
}
