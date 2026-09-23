# DSH Ollama Control

A small [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) Web
bundle that adds a protected Ollama control to both the New Session page and
the Session header.

- Red play icon: the managed Ollama service is stopped; click to choose a model.
- Green stop icon: the managed Ollama service is reachable; click to choose or stop a model.
- Disabled spinner: a start or stop operation is in progress.

The indicator distinguishes a managed Ollama process from another service on
port 11434. An external process is shown but cannot be stopped or used for
model loading through this control.

This plugin targets Linux and WSL. Its process-ownership check reads `/proc`,
and the supplied service scripts use Linux shell utilities. A reachable
service without a matching managed PID is deliberately treated as external.

## Requirements

This bundle does not install Ollama or download models. It expects a
user-managed root with these fixed scripts:

```text
<ollama-root>/scripts/start.sh
<ollama-root>/scripts/stop.sh
```

By default, `<ollama-root>` is `~/devtools/ollama`. Those scripts should bind
Ollama only to `127.0.0.1:11434` and verify their PID before stopping a process.

## Selecting a local model

The dialog lists only explicitly registered Ollama models and confirms that
their manifests exist below `~/devtools/ollama/models/manifests/`. "Can attempt
to load" does not mean that inference has been verified. Selecting a model
starts Ollama when needed and preloads it for five minutes. The browser
cannot provide an arbitrary model name, executable, or filesystem path.

The default registered model is `minicpm5-2b:q4km`. Configure models for your
own machine with `localModels` in the Web profile's
`~/.dsh/profiles/web/cordis.patch.yml`; each manifest path is relative to the
Ollama manifests directory. For example:

```yaml
- id: ollama-control
  config:
    root: /home/example/devtools/ollama
    localModels:
      - model: minicpm5-2b:q4km
        displayName: MiniCPM5-2B Q4_K_M
        manifestPath: registry.ollama.ai/library/minicpm5-2b/q4km
      - model: mimo-v2.6-distill-qwen-9b:q4_k_s
        displayName: MiMo-V2.6-Distill-Qwen-9B Q4_K_S
        manifestPath: registry.ollama.ai/library/mimo-v2.6-distill-qwen-9b/q4_k_s
```

GGUF import routes remain allowlisted separately and are not shown in the
model-selection dialog.

`GET /ollama-control/status` is retained as a lightweight diagnostic endpoint
for the managed, stopped, or external service state; the Web UI reads the
model-aware `GET /ollama-control/models` endpoint instead.

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
directory. Model names are checked against the host-side allowlist. The host
route relies on DSH browser authentication and Origin/Host checks, and invokes
only `<root>/scripts/start.sh` or `<root>/scripts/stop.sh`. Script output is not
returned to the browser.

This project contains no model weights, Ollama blobs, logs, DSH state, or API
keys.

## Compatibility

Validated with DeepSeek Harness `0.1.7-alpha.1` on Linux/WSL. DSH's
client-bundle protocol is internal and may change in later releases.

## License

[MIT](LICENSE)
