# LokalMind Vision Probe

Desktop experiment for running local GGUF models through `llama.cpp` `llama-server`.

It supports two workflows:

- Chat that defaults to no saved memory, with optional app-style memory stored in SQLite.
- Deterministic image probes that test whether a model can process real image input.

This does not change the production mobile app.

## Requirements

- Node.js 26 or newer
- npm
- `llama-server` from `llama.cpp`
- GGUF model files

On Windows, install `llama.cpp` with:

```powershell
winget install --id ggml.llamacpp --exact
```

Check that `llama-server` works:

```powershell
llama-server --version
```

If it is not on PATH, use the full path:

```powershell
$llama = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\ggml.llamacpp_Microsoft.Winget.Source_8wekyb3d8bbwe\llama-server.exe"
& $llama --version
```

## Setup

Run commands from the experiment root, not from `src`.

```powershell
cd "C:\Users\ysharma1\OneDrive - Red Deer College\Documents\GitHub\lokalmind_image_probe\experiments\vision-probe"
npm install
npm run generate-fixtures
```

For the guided workflow, run:

```powershell
npm run wizard
```

The wizard can download models, configure `llama-server.exe`, run chat, run image probes, and print reports.

Always pass CLI flags after `--`:

```powershell
npm run chat -- --model qwen3.5-0.8b --auto-server --message "Hello"
```

## Download Models

List registered models:

```powershell
npm run list-models
```

Registered app catalog models:

```text
qwen3.5-0.8b
qwen3.5-2b
deepseek-r1-1.5b
qwen3.5-4b
qwen3-4b
gemma3-4b
gemma3-4b-vision
smolvlm-256m-vision
smolvlm2-2.2b-vision
qwen2.5-vl-3b-vision
```

For app catalog models, set the CDN base URL first:

```powershell
$env:VISION_PROBE_MODEL_BASE_URL="https://your-model-cdn-base-url"
```

Download a model:

```powershell
npm run download-model -- --model deepseek-r1-1.5b
```

Download the embedding model used for optional semantic memory:

```powershell
npm run download-embedding
```

If a model is not on your CDN, add it to `src/domain/modelArtifacts.ts` with a direct `modelUrl`.

Example:

```ts
'custom-model': {
  id: 'custom-model',
  label: 'Custom Model',
  filename: 'custom-model-Q4_K_M.gguf',
  modelUrl: 'https://huggingface.co/org/repo/resolve/main/custom-model-Q4_K_M.gguf',
  sizeBytes: 1234567890,
  requiresMmproj: false,
  contextSize: 8192,
  notes: 'External GGUF model.',
},
```

For a vision model, also add `mmprojFilename`, `mmprojUrl`, and set `requiresMmproj: true`.

## Start Servers Manually

In this Windows environment, Node may fail to spawn `llama-server` with `spawn EPERM`. Manual server mode avoids that.

Set the executable path:

```powershell
$llama = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\ggml.llamacpp_Microsoft.Winget.Source_8wekyb3d8bbwe\llama-server.exe"
```

Start the chat model in Terminal 1:

```powershell
& $llama -m ".\.data\models\deepseek-r1-1.5b\DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf" -c 8192 --host 127.0.0.1 --port 8080
```

Start the embedding model in Terminal 2:

```powershell
& $llama -m ".\.data\models\all-minilm-l6-v2\all-MiniLM-L6-v2-Q4_K_M.gguf" --embedding --pooling mean -c 512 --host 127.0.0.1 --port 8081
```

For the Gemma vision model, start a separate server:

```powershell
& $llama -m ".\.data\models\gemma3-4b-vision\gemma-3-4b-it-Q4_K_M.gguf" --mmproj ".\.data\models\gemma3-4b-vision\mmproj-model-f16.gguf" -c 8192 --host 127.0.0.1 --port 8082
```

## Run Chat

Run chat in another terminal. By default, chat does not read saved history, profile, facts, or memories:

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

Check stored chat and memory:

```powershell
npm run memory-report
```

The chat flow always stores raw chat messages. When `--with-memory` is enabled, it can also read and maintain profile, summaries, and memory checkpoints.

`--no-embeddings` does not mean no memory. It only means `--with-memory` should use score fallback instead of semantic embedding retrieval.

```text
chat_messages              raw persistent chat history
session_summaries          rolling chat summaries
session_memories           memory checkpoints
session_memories.embedding semantic vectors for memory retrieval
```

## Run Image Probe

Probe a text model:

```powershell
npm run probe -- --model deepseek-r1-1.5b --server http://127.0.0.1:8080
npm run report
```

Probe the vision model:

```powershell
npm run probe -- --model gemma3-4b-vision --server http://127.0.0.1:8082
npm run report
```

Other registered vision model ids:

```text
smolvlm-256m-vision
smolvlm2-2.2b-vision
qwen2.5-vl-3b-vision
```

Each probe runs four image tests and four no-image controls. Probe runs are memory-free and deterministic; they do not read chat history, profile, facts, or saved memories.

The prompts are:

```text
shapes-basic:
List the visible shapes and their colors.

spatial-left-right:
What object is on the left, and what object is on the right?

ocr-simple:
What exact text appears in the image?

counting-grid:
How many black dots and orange rectangles are visible?
```

The system prompt is:

```text
You are a precise visual inspection assistant. Answer only from the provided image. Keep the answer short and literal.
```

## Auto Server Mode

If Node can spawn child processes on your machine, you can use auto server mode:

```powershell
npm run chat -- --model deepseek-r1-1.5b --auto-server --message "Hello"
npm run chat -- --model deepseek-r1-1.5b --auto-server --with-memory --auto-embedding-server --message "Hello"
```

```powershell
npm run probe -- --model gemma3-4b-vision --auto-server
```

If you see `spawn EPERM`, use manual server mode instead.

## Data Files

SQLite database:

```text
.data/vision-probe.db
```

Settings:

```text
.data/settings.json
```

Downloaded models:

```text
.data/models/
```

Generated image fixtures:

```text
.data/fixtures/
```

## Common Problems

`Unknown option: qwen3.5-0.8b`

You forgot the npm argument separator. Use:

```powershell
npm run chat -- --model qwen3.5-0.8b
```

`Model uses the app model CDN`

Set the CDN base URL:

```powershell
$env:VISION_PROBE_MODEL_BASE_URL="https://your-model-cdn-base-url"
```

`spawn llama-server ENOENT`

`llama-server` is not on PATH. Use the full exe path or manual server mode.

`spawn EPERM`

Node is blocked from launching `llama-server`. Start `llama-server` manually and pass `--server`.

Downloaded size mismatch

The registry expected byte size does not match the actual file. Update `sizeBytes` in `src/domain/modelArtifacts.ts`, then rerun with `--force`.

## Scripts

```text
npm run generate-fixtures
npm run wizard
npm run list-models
npm run download-model -- --model <id>
npm run download-embedding
npm run chat -- --model <id> --server <url> --message <text>
npm run chat -- --model <id> --server <url> --with-memory --no-embeddings --message <text>
npm run memory-report
npm run probe -- --model <id> --server <url>
npm run report
npm run typecheck
npm run test
```
