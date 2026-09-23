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

This bundle does not install Ollama or download models. The tested environment
was Ubuntu WSL, DeepSeek Harness `0.1.7-alpha.1`, Node.js `22.23.2`, pnpm
`11.7.0`, and Ollama `0.33.3`. These are tested versions, not claimed minimums.
The script examples use Bash, `ss` (iproute2), `curl`, and standard Linux
utilities. Install Ollama using its [official Linux instructions](https://docs.ollama.com/linux).

The plugin expects a user-managed root with these fixed scripts:

```text
<ollama-root>/scripts/start.sh
<ollama-root>/scripts/stop.sh
```

By default, `<ollama-root>` is `~/devtools/ollama`. The repository includes the
same [start](examples/managed-ollama/scripts/start.sh) and
[stop](examples/managed-ollama/scripts/stop.sh) scripts used in the tested WSL
setup. They bind Ollama to `127.0.0.1:11434`, keep models under the managed
root, and verify the recorded process before stopping it. Review them before
using them with another installation.

For a fresh managed root, place a working Ollama executable at
`<ollama-root>/bin/ollama` **and its matching runner libraries** under
`<ollama-root>/lib/ollama/`, preserving the layout of Ollama's official Linux
manual-install archive. Copying only the executable can lose GPU support.
Then install the example scripts:

```bash
OLLAMA_ROOT="$HOME/devtools/ollama"
mkdir -p "$OLLAMA_ROOT/bin" "$OLLAMA_ROOT/scripts"
# Install matching Ollama bin/ and lib/ contents here first (see official docs).
install -m 755 examples/managed-ollama/scripts/start.sh "$OLLAMA_ROOT/scripts/start.sh"
install -m 755 examples/managed-ollama/scripts/stop.sh "$OLLAMA_ROOT/scripts/stop.sh"
"$OLLAMA_ROOT/bin/ollama" --version
test -d "$OLLAMA_ROOT/lib/ollama"
"$OLLAMA_ROOT/scripts/start.sh"
```

Run these commands from this repository's checkout. Do not overwrite existing
scripts without reviewing local changes. If another Ollama instance already
owns port 11434, stop it through its own service manager first; this plugin
will not take control of an external process.

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
    root: /absolute/path/to/ollama-root
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

### Reproduce the tested MiMo model

The tested model used the main file
[`MiMo-V2.6-Distill-Qwen-9B-Q4_K_S.gguf`](https://huggingface.co/bartowski/MiMo-V2.6-Distill-Qwen-9B-GGUF/blob/main/MiMo-V2.6-Distill-Qwen-9B-Q4_K_S.gguf)
and the vision projector
[`mmproj-MiMo-V2.6-Distill-Qwen-9B-f16.gguf`](https://huggingface.co/bartowski/MiMo-V2.6-Distill-Qwen-9B-GGUF/blob/main/mmproj-MiMo-V2.6-Distill-Qwen-9B-f16.gguf)
from the [bartowski GGUF repository](https://huggingface.co/bartowski/MiMo-V2.6-Distill-Qwen-9B-GGUF).
They are **not** included here. The files tested locally had these SHA-256
digests (check your download with `sha256sum`):

```text
MiMo-V2.6-Distill-Qwen-9B-Q4_K_S.gguf       db48a409bf4c11033ab4bd24ff3b1ee028578a5acc62e0b34887edbed9708253
mmproj-MiMo-V2.6-Distill-Qwen-9B-f16.gguf  ff348f3180a63188aa7285db85f550fe38acb61dd013c599eb8bad08d2cc2576
```

Save this `Modelfile`, replacing both paths with the absolute paths to your
downloaded files. This two-`FROM` form is the one used in the tested Ollama
`0.33.3` setup; [Ollama's Modelfile reference](https://docs.ollama.com/modelfile)
explains GGUF paths and `ollama create`.

```text
FROM /absolute/path/to/MiMo-V2.6-Distill-Qwen-9B-Q4_K_S.gguf
FROM /absolute/path/to/mmproj-MiMo-V2.6-Distill-Qwen-9B-f16.gguf
PARAMETER num_ctx 16384
```

With the managed Ollama service running, import and inspect the result:

```bash
"$OLLAMA_ROOT/bin/ollama" create mimo-v2.6-distill-qwen-9b:q4_k_s -f /absolute/path/to/Modelfile
"$OLLAMA_ROOT/bin/ollama" show mimo-v2.6-distill-qwen-9b:q4_k_s
"$OLLAMA_ROOT/bin/ollama" list
```

The tested `ollama show` reported `Q4_K_S` plus `vision` capability. A model
appearing in `ollama list` alone does not prove that inference succeeds. The
tested model also returned text and image responses through Ollama's
`/v1/chat/completions` endpoint. Model licensing and download terms remain with
the upstream model repository.

The plugin's `localModels` list controls its popup only. To make an imported
model available in DSH's chat model selector, also merge a provider entry into
the `llm-pi-ai` row of `~/.dsh/profiles/web/cordis.patch.yml` (do not remove
unrelated providers):

```yaml
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      ollama-local:
        displayName: Local Ollama
        api: openai-completions
        baseURL: http://127.0.0.1:11434/v1
        models:
          - id: mimo-v2.6-distill-qwen-9b:q4_k_s
            name: MiMo-V2.6-Distill-Qwen-9B Q4_K_S
            contextWindow: 16384
            maxTokens: 2048
            input: [text, image]
            reasoningEfforts: false
        compat:
          supportsDeveloperRole: false
          supportsReasoningEffort: false
          supportsUsageInStreaming: false
        apiKeyEnv: OLLAMA_LOCAL_API_KEY
```

In the tested DSH version, naming `apiKeyEnv` requires a nonempty value in
the local credential store or launch environment. The loopback Ollama endpoint
does not need a real remote API key; use a local placeholder and never commit
credentials. Adjust context size and modality declarations to match any other
model you register.

`GET /ollama-control/status` is retained as a lightweight diagnostic endpoint
for the managed, stopped, or external service state; the Web UI reads the
model-aware `GET /ollama-control/models` endpoint instead.

## Install

Clone this repository, then build and check the DSH client artifact:

```bash
git clone https://github.com/luoshu9000/dsh-ollama-control.git
cd dsh-ollama-control
pnpm install
pnpm build
pnpm check
```

From a compatible DSH source checkout, install the bundle into the Web profile:

```bash
pnpm dsh plugin --profile web add /absolute/path/to/dsh-ollama-control
```

Restart `pnpm dsh web --port 18080` after installation or an update. Open the
local Web page, select a registered model in the Ollama control, then select
that model separately in the chat composer. The Web profile must contain both
the `localModels` and `llm-pi-ai` entries above for the tested MiMo setup.

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
