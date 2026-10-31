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
