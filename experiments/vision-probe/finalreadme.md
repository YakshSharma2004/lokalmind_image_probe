# LokalMind Vision Probe

Desktop-only tool for testing local GGUF models with `llama.cpp` `llama-server`.

It can:

- download registered models
- run chat with no saved memory by default
- optionally run persistent chat with SQLite memory
- run deterministic image probes to check whether a model actually understands image input
- use a guided terminal wizard so you do not have to remember every command

This does not change the production mobile app.

## Requirements

- Node.js 26 or newer
- npm
- `llama-server`

Install `llama-server` on Windows:

```powershell
winget install --id ggml.llamacpp --exact
```

If `llama-server` is not on PATH, the usual Winget path is:

```powershell
C:\Users\<your-user>\AppData\Local\Microsoft\WinGet\Packages\ggml.llamacpp_Microsoft.Winget.Source_8wekyb3d8bbwe\llama-server.exe
```

## Setup

Run everything from the experiment folder:

```powershell
cd "C:\Users\ysharma1\OneDrive - Red Deer College\Documents\GitHub\lokalmind_image_probe\experiments\vision-probe"
npm install
npm run generate-fixtures
```

## Recommended: Use The Wizard

```powershell
npm run wizard
```

The wizard lets you:

- configure the path to `llama-server.exe`
- see downloaded models
- download a model
- download the embedding model
- chat with a model
- run the image compatibility probe
- view memory and probe reports

If the wizard asks for `llama-server.exe`, paste the full path ending in:

```text
llama-server.exe
```

## Download Models

List registered models:

```powershell
npm run list-models
```

Download a model:

```powershell
npm run download-model -- --model smolvlm-256m-vision
```

Download the embedding model for optional semantic memory:

```powershell
npm run download-embedding
```

Some app catalog models use the app CDN. For those, set the CDN base URL first:

```powershell
$env:VISION_PROBE_MODEL_BASE_URL="https://your-model-cdn-base-url"
```

Vision model ids currently registered:

```text
gemma3-4b-vision
smolvlm-256m-vision
smolvlm2-2.2b-vision
qwen2.5-vl-3b-vision
```

Text/control model ids currently registered:

```text
qwen3.5-0.8b
qwen3.5-2b
deepseek-r1-1.5b
qwen3.5-4b
qwen3-4b
gemma3-4b
```

## Run A Model Directly With llama-server

You can run a downloaded model without the Node chat/probe app.

```powershell
$llama = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\ggml.llamacpp_Microsoft.Winget.Source_8wekyb3d8bbwe\llama-server.exe"

& $llama -m ".\.data\models\deepseek-r1-1.5b\DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf" -c 8192 --host 127.0.0.1 --port 8080
```

For a vision model, include the projector:

```powershell
& $llama `
  -m ".\.data\models\smolvlm-256m-vision\SmolVLM-256M-Instruct-Q8_0.gguf" `
  --mmproj ".\.data\models\smolvlm-256m-vision\mmproj-SmolVLM-256M-Instruct-Q8_0.gguf" `
  -c 2048 `
  --host 127.0.0.1 `
  --port 8080
```

## Run Chat

Start a model server first, then run chat. By default, chat does not read saved history, profile, facts, or memories:

```powershell
npm run chat -- --model deepseek-r1-1.5b --server http://127.0.0.1:8080 --message "Hello"
```

Chat generation uses `CHAT_MAX_TOKENS` when `--max-tokens` is not passed. The default is `512`.

Use saved memory with score fallback:

```powershell
npm run chat -- --model deepseek-r1-1.5b --server http://127.0.0.1:8080 --with-memory --no-embeddings --message "what is my name"
```

Use saved memory with semantic embeddings:

```powershell
npm run chat -- --model deepseek-r1-1.5b --server http://127.0.0.1:8080 --with-memory --embedding-server http://127.0.0.1:8081 --message "My name is Yaksh."
```

Chat messages are stored in SQLite. Profile, summaries, and memories are only read and maintained when `--with-memory` is enabled.

`--no-embeddings` does not mean no memory. It only means `--with-memory` should use score fallback instead of semantic embedding retrieval.

```text
.data/vision-probe.db
```

Check memory state:

```powershell
npm run memory-report
```

Debug a blank or strange response:

```powershell
npm run chat -- --model deepseek-r1-1.5b --server http://127.0.0.1:8080 --with-memory --no-embeddings --message "what is my name" --max-tokens 2048 --debug
```

## Run Image Probe

Start a model server first, then run:

```powershell
npm run probe -- --model smolvlm-256m-vision --server http://127.0.0.1:8080
npm run report
```

The probe sends four generated PNG images and four no-image controls. A model only looks vision-capable if image results beat the no-image controls. Probe runs are memory-free and deterministic.

Probe prompts:

```text
List the visible shapes and their colors.
What object is on the left, and what object is on the right?
What exact text appears in the image?
How many black dots and orange rectangles are visible?
```

## Useful Files

```text
.data/models/             downloaded models
.data/fixtures/           generated PNG test images
.data/settings.json       local settings and downloaded model state
.data/vision-probe.db     SQLite chat, memory, and probe results
src/domain/modelArtifacts.ts
```

## Common Problems

`Unknown option`

Use `--` before CLI flags:

```powershell
npm run chat -- --model deepseek-r1-1.5b --message "Hello"
```

`llama-server not found`

Use the wizard option to save the full `llama-server.exe` path.

`spawn EPERM` or `spawn EINVAL`

Node is blocked from launching a child process. Start `llama-server` manually and use `--server http://127.0.0.1:<port>`.

`Downloaded size mismatch`

The expected byte size in `modelArtifacts.ts` does not match the actual download. Update the size or rerun with `--force` after fixing the registry.
