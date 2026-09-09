# DSH Ollama Control

A small [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) Web
bundle that adds a protected Ollama control to the Session header.

- Red play icon: the managed Ollama service is stopped; click to start it.
- Green stop icon: the Ollama API is reachable; click to stop it.
- Disabled spinner: a start or stop operation is in progress.

## Requirements

This bundle does not install Ollama or download models. It expects a
user-managed root with these fixed scripts:

```text
<ollama-root>/scripts/start.sh
<ollama-root>/scripts/stop.sh
```

By default, `<ollama-root>` is `~/devtools/ollama`. Those scripts should bind
Ollama only to `127.0.0.1:11434` and verify their PID before stopping a process.

## Install

From this repository, build and check the DSH client artifact:

```bash
pnpm install
pnpm build
pnpm check
```

From a compatible DSH source checkout, install the bundle into the Web profile:

```bash
pnpm dsh plugin --profile web add /absolute/path/to/dsh-ollama-control
```

Restart `pnpm dsh web` after installation or an update.

## Custom root

For an Ollama root other than `~/devtools/ollama`, override the installed row
in the Web profile's `cordis.patch.yml`:

```yaml
- id: ollama-control
  config:
    root: /absolute/path/to/ollama
```

## Security

The browser never supplies a shell command, executable path, or working
directory. The host route relies on DSH browser authentication and Origin/Host
checks, and invokes only `<root>/scripts/start.sh` or `<root>/scripts/stop.sh`.
Script output is not returned to the browser.

This project contains no model weights, Ollama blobs, logs, DSH state, or API
keys.

## Compatibility

Developed against DeepSeek Harness `0.1.3-alpha.2`. DSH's client-bundle
protocol is internal and may change in later releases.

## License

[MIT](LICENSE)
