# open-vault-prompt

A Claude Code plugin that lets Claude ask you for a **new secret** (API key,
password, token) without the value ever entering the chat. The value goes
straight into [Open Vault](https://github.com/open-vault/open-vault), and
Claude only hears back "stored" or "cancelled".

It ships two pieces:

- **A mod** that registers the tool `request_secret`. When Claude calls it, a
  one-line masked input appears above your prompt box. You paste the secret,
  press Enter, and the mod pipes it to `ovault secret set ... --file /dev/stdin`.
  The typed value is kept only in the mod's memory: never in session state, a
  tool result, a log line, or the model's context.
- **A skill** (`open-vault-passwords`) that tells Claude to use the dialog
  instead of asking you to paste secrets, to read stored secrets only by piping
  `ovault secret get --raw` into a command, and never to write secrets to files,
  memory or replies.

## Requirements

- Claude Code with mods (plugin `hooks/` modules) support. The dialog draws in
  the terminal, desktop and IDE surfaces; it is not shown on mobile.
- [Open Vault](https://github.com/open-vault/open-vault) installed and set up,
  with `ovault` on your `PATH` (also looked up in `~/.local/bin`, `~/.bun/bin`,
  `/opt/homebrew/bin`, `/usr/local/bin`). For any other location, set
  `OVAULT_BIN=/path/to/ovault`.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install open-vault-prompt --marketplace vahidkaargar/open-vault-prompt
```

Answer `y` to add the marketplace, then choose a scope (user scope makes it
available in every project).

## Usage

Ask Claude for something that needs a credential, or tell it directly:

> Store my Stripe test key in the vault.

Claude calls `request_secret` with a name (`STRIPE_API_KEY`), a project
(`stripe`) and a reason. The input appears above your prompt:

```
STRIPE_API_KEY stripe [ paste secret, Enter to store ] Store ✕
```

- **Enter / Store** encrypts and stores it, creating the project if needed.
  If the name already exists, the dialog says `(new version)`.
- **✕** cancels; nothing is stored and Claude is told not to ask again.

Later, Claude uses the secret without seeing it:

```bash
ovault secret get STRIPE_API_KEY --project stripe --raw | some-cli --token-stdin
```

## Security notes

- Secret and project names are checked against `^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$`
  before anything runs; arguments reach `ovault` as positional parameters, never
  through a shell string.
- The value is passed on stdin, never on a command line (`ps` cannot see it).
- Only one request can be open at a time.
- Open Vault itself is an early-stage, single-author project. Review it before
  trusting it with important secrets, and back up its key file.
- This plugin keeps the secret out of the chat; it does not stop a model from
  later running `ovault secret get` without `--raw` piping. The bundled skill
  instructs against that, and your permission settings are the hard barrier.

## Development

```bash
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

## License

MIT
