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
  tool result, a log line, or the model's context. It also adds the
  `/ovault-test` command for a hands-on check.
- **A skill** (`open-vault-passwords`) that tells Claude to use the dialog
  instead of asking you to paste secrets, to read stored secrets only by piping
  `ovault secret get --raw` into a command, and never to write secrets to files,
  memory or replies.

## Setup, step by step

Tested on macOS. Linux should work the same way. Allow about 10 minutes; step 2
downloads dependencies and can take several minutes.

### Step 1: install Bun

Open Vault runs on [Bun](https://bun.sh). Skip this step if `bun --version`
already works.

```bash
curl -fsSL https://bun.sh/install | bash
```

Open a new terminal afterwards, then check:

```bash
bun --version
```

### Step 2: install Open Vault

Open Vault is not published to npm yet, so install it from source. The commands
pin the commit this plugin was tested with (`4a07fe2`).

```bash
git clone https://github.com/open-vault/open-vault.git ~/.open-vault/src
git -C ~/.open-vault/src checkout 4a07fe2
cd ~/.open-vault/src && bun install --filter '@open-vault/cli' --omit=optional
```

The `--filter` installs only the command-line tool, not the web app, which is
much faster.

Next, create the `ovault` command. The name `ov` is avoided on purpose: other
tools use it.

```bash
mkdir -p ~/.local/bin
printf '#!/bin/sh\nexec bun "$HOME/.open-vault/src/apps/cli/src/index.ts" "$@"\n' > ~/.local/bin/ovault
chmod +x ~/.local/bin/ovault
```

If `ovault` is not found in a new terminal, add `~/.local/bin` to your `PATH`.
For zsh:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
```

### Step 3: create your vault

Open Vault derives its encryption key from an SSH key. Use a **dedicated** key
for the vault, not your everyday `~/.ssh` key:

```bash
ssh-keygen -t ed25519 -N "" -C open-vault -f ~/.open-vault/vault_key
chmod 600 ~/.open-vault/vault_key
```

Set up local storage (encrypted files under `~/.open-vault/vault`) and sign in:

```bash
ovault auth init --adapter local --key ~/.open-vault/vault_key
ovault auth login
```

> **Back up `~/.open-vault/vault_key` somewhere outside this computer.** Every
> secret is encrypted with a key derived from it. If you lose that file, you
> lose the vault. Anyone who has that file and your vault files can decrypt
> everything.

### Step 4: check the vault from the terminal

```bash
ovault project create personal
printf 'hello123' | ovault secret set SETUP_CHECK --project personal --file /dev/stdin
ovault secret get SETUP_CHECK --project personal --raw | wc -c
ovault secret delete SETUP_CHECK --project personal
```

Expected output, in order: `✓ Project created: personal (...)`,
`✓ Encrypted and stored`, `8`, `✓ Secret "SETUP_CHECK" deleted.`

The `--file /dev/stdin` part matters: without it, a piped value can be silently
dropped.

### Step 5: install the plugin

At the prompt of a Claude Code terminal session:

```
/plugin install open-vault-prompt --marketplace vahidkaargar/open-vault-prompt
```

Answer `y` to add the marketplace, then choose a scope (user scope makes it
available in every project). **Restart Claude Code** so the plugin loads.

### Step 6: test it yourself

In a new Claude Code session, type:

```
/ovault-test
```

1. A field labelled `OVP_SELFTEST` appears above your prompt box.
2. Type any dummy text (**not** a real secret), for example `hello123`, and
   press Enter. The field shows only `••••••••`.
3. The plugin stores the value in project `ovp-selftest`, decrypts it back,
   compares it, and deletes it. This all happens locally: Claude is not involved
   and sees nothing.
4. You should see a green line:
   `Open Vault self-test: PASS: stored 8 characters, decrypted them back identical, test secret deleted.`
   Close it with ✕.

Then try the real flow. Ask Claude:

> Use request_secret to ask me for a test value named DEMO_TOKEN in project demo.

Type anything, press Enter. Claude should reply that `DEMO_TOKEN` is stored
**without** being able to quote what you typed. Remove it afterwards:

```bash
ovault secret delete DEMO_TOKEN --project demo
```

## Troubleshooting

| What you see | Fix |
|---|---|
| `Not stored: ovault not found` | Step 2 is not done, or `ovault` is somewhere else. Set `OVAULT_BIN=/full/path/to/ovault` in your environment. The plugin looks in `PATH`, `~/.local/bin`, `~/.bun/bin`, `/opt/homebrew/bin` and `/usr/local/bin`. |
| `Not stored: ovault is not logged in` | Run `ovault auth login`. |
| `/ovault-test` is an unknown command, or Claude has no `request_secret` tool | The plugin is not loaded. Run `/plugin` to check that it is installed and enabled, then restart Claude Code. |
| No field appears | The field is not shown on the mobile app. Use the terminal, desktop or an IDE. |
| `FAIL: the value read back differs` | Report it as an issue with your OS and Bun version. Do not include the value. |

## Using it

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
  before anything runs. Arguments reach `ovault` as separate parameters, never
  through a shell string.
- The value is passed on stdin, never on a command line, so `ps` cannot see it.
- Only one request can be open at a time.
- Open Vault itself is an early-stage, single-author project. Review it before
  trusting it with important secrets, and back up its key file.
- This plugin keeps the secret out of the chat. It does not stop a model from
  later running `ovault secret get` and printing the result. The bundled skill
  instructs against that; your Claude Code permission settings are the hard
  barrier.

## Development

```bash
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

## License

MIT
