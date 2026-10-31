import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'open-vault-prompt',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const RUN_TEST = {
  command: 'ovault-test',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

const ran = (exitCode: number, stdout: string, stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

test('the dialog masks the value and stores it without telling the model', async ($, on) => {
  const runs: { argv: readonly string[]; stdin?: string }[] = []
  const prompts: string[] = []

  on('process.run', (_, e) => {
    runs.push({ argv: e.argv, stdin: e.init?.stdin })
    const args = e.argv.slice(4).join(' ')
    if (args === 'project list') return ran(0, '  app  (id)  [USER]\n', '')
    if (args.startsWith('secret list')) return ran(0, 'No secrets.\n', '')
    if (args.startsWith('secret set')) return ran(0, '✓ Encrypted and stored\n', '')

    return ran(1, '', 'unexpected')
  })
  on('tool.register', () => ({ value: { tool: 'mcp__open-vault-prompt__request_secret' } }))
  on('ui.notify', () => ({ value: { isSent: true, channel: 'terminal_bell' as const } }))
  on('prompt.submit', (_, e) => {
    prompts.push(e.text)

    return { text: e.text }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const called = await $.tool.call({
    tool: 'mcp__open-vault-prompt__request_secret',
    secret_name: 'STRIPE_KEY',
    project: 'app',
    reason: 'billing',
  })
  expect(called.deny).toBeUndefined()

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /STRIPE_KEY/ })).toBeTruthy()

  await ui.input({ key: 'secret', text: 's3cr3t', kind: 'change' })
  const field = await ui.find({ type: 'Input', key: 'secret' })
  expect(JSON.stringify(field)).not.toContain('s3cr3t')
  expect(JSON.stringify(field)).toContain('••••••')

  await ui.input({ key: 'secret', text: '••••••', kind: 'submit' })

  const set = runs.find(r => r.argv.includes('set'))
  expect(set?.stdin).toBe('s3cr3t')
  expect(set?.argv).toContain('STRIPE_KEY')
  expect(set?.argv.slice(0, 2)).toEqual(['/bin/sh', '-c'])
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain('STRIPE_KEY')
  expect(prompts[0]).not.toContain('s3cr3t')
  await ui.unmount()
})

test('a bad name is refused before any dialog opens', async ($, on) => {
  on('process.run', () => (ran(0, '/Users/test', '')))
  on('tool.register', () => ({ value: { tool: 'x' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const called = await $.tool.call({
    tool: 'mcp__open-vault-prompt__request_secret',
    secret_name: '--evil',
    project: 'app',
    reason: 'x',
  })
  expect(called.deny).toContain('letters, digits')
})

test('/ovault-test stores, reads back, compares and deletes without involving the model', async ($, on) => {
  const vault = new Map<string, string>()
  const prompts: string[] = []
  on('process.run', (_, e) => {
    const a = e.argv.slice(4)
    const args = a.join(' ')
    if (args === 'project list') return ran(0, '')
    if (args.startsWith('project create')) return ran(0, '✓ Project created\n')
    if (args.startsWith('secret list')) return ran(0, 'No secrets.\n')
    if (a[0] === 'secret' && a[1] === 'set') {
      vault.set(a[2] ?? '', e.init?.stdin ?? '')
      return ran(0, '✓ Encrypted and stored\n')
    }
    if (a[0] === 'secret' && a[1] === 'get') return ran(0, `${vault.get(a[2] ?? '') ?? ''}\n`)
    if (a[0] === 'secret' && a[1] === 'delete') {
      vault.delete(a[2] ?? '')
      return ran(0, '✓ deleted\n')
    }
    return ran(1, '', 'unexpected')
  })
  on('tool.register', () => ({ value: { tool: 'mcp__open-vault-prompt__request_secret' } }))
  on('command.register', () => ({ value: { command: 'ovault-test' } }))
  on('prompt.submit', (_, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ran1 = await $.command.run(RUN_TEST)
  expect(ran1.text).toContain('Self-test dialog opened')

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.input({ key: 'secret', text: 'hello123', kind: 'change' })
  await ui.input({ key: 'secret', text: '••••••••', kind: 'submit' })

  expect(await ui.find({ type: 'Text', text: /PASS: stored 8 characters/ })).toBeTruthy()
  expect(vault.has('OVP_SELFTEST')).toBe(false)
  expect(prompts).toHaveLength(0)
  await ui.unmount()
})

test('a missing ovault binary gives an install hint', async ($, on) => {
  on('process.run', () => ran(127, '', 'sh: ovault: not found'))
  on('tool.register', () => ({ value: { tool: 'mcp__open-vault-prompt__request_secret' } }))
  on('command.register', () => ({ value: { command: 'ovault-test' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run(RUN_TEST)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.input({ key: 'secret', text: 'x', kind: 'change' })
  await ui.input({ key: 'secret', text: '•', kind: 'submit' })
  expect(await ui.find({ type: 'Text', text: /ovault not found/ })).toBeTruthy()
  await ui.unmount()
})
