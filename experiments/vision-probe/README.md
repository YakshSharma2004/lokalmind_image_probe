# LokalMind Vision Probe

Desktop-only experiment for testing whether local GGUF models can process real image input through `llama.cpp` `llama-server`.

This does not change the mobile app. The current app runtime is text-only at the `llama.rn` boundary: `LLMMessage.imagePath` exists, but the production adapter sends only `{ role, content }`. This probe mirrors the app's local-first backend shape with desktop adapters.

## Setup

```bash
cd experiments/vision-probe
npm install
npm run generate-fixtures
```

Download the default vision model and projector:

```bash
npm run download-model -- --model gemma3-4b-vision
```

Download the app-style semantic memory embedding model:

```powershell
npm run download-embedding
```

The app catalog text models are also registered. They use the same CDN path pattern as the mobile app:

```text
<base-url>/models/<model-id>/<filename>
```

Set the base URL before downloading one of those models:

```powershell
$env:VISION_PROBE_MODEL_BASE_URL="https://your-model-cdn.example"
npm run download-model -- --model qwen3.5-0.8b
```

`HETZNER_BASE_URL` and `HETZNER_WEBDAV_URL` are also accepted if those are already set in your shell.

Run the probe with a managed `llama-server` process:

```bash
npm run probe -- --model gemma3-4b-vision --auto-server
npm run report
```

Run one persistent chat turn with app-style memory/context:

```powershell
npm run chat -- --model qwen3.5-0.8b --auto-server --auto-embedding-server --message "My name is Yaksh and I am testing local model memory."
npm run memory-report
```

The CLI assumes `llama-server` is available on `PATH`. Use a custom binary path when needed:

```bash
npm run probe -- --model gemma3-4b-vision --auto-server --llama-server-bin C:\path\to\llama-server.exe
```

The same custom binary option works for chat and the embedding server:

```powershell
npm run chat -- --model qwen3.5-0.8b --auto-server --auto-embedding-server --llama-server-bin C:\path\to\llama-server.exe --message "What do you remember about me?"
```

## Manual Server Mode

You can still start a multimodal `llama-server` separately:

```bash
llama-server -hf ggml-org/gemma-3-4b-it-GGUF -c 8192 --port 8080
```

Manual local model/projector mode:

```bash
llama-server -m <model.gguf> --mmproj <mmproj.gguf> -c 8192 --port 8080
```

## Run

```bash
npm run probe -- --model gemma3-4b-vision --server http://127.0.0.1:8080
npm run report
```

Useful options:

```bash
npm run probe -- \
  --model gemma3-4b-vision \
  --auto-server \
  --fixtures .data/fixtures \
  --temperature 0 \
  --max-tokens 128 \
  --timeout-ms 120000 \
  --context-size 8192
```

Helpful model commands:

```bash
npm run list-models
npm run print-server-command -- --model gemma3-4b-vision
```

Persistent chat commands:

```powershell
npm run chat -- --model qwen3.5-0.8b --auto-server --message "Hello"
npm run chat -- --model qwen3.5-0.8b --auto-server --auto-embedding-server --message "What was I working on before?"
npm run memory-report
```

The chat command stores raw chat rows in SQLite, rolling summaries in `session_summaries`, and memory checkpoints in `session_memories`. Embeddings are stored only on `session_memories.embedding` and are used for semantic retrieval.

Registered app catalog model ids:

```text
qwen3.5-0.8b
qwen3.5-2b
deepseek-r1-1.5b
qwen3.5-4b
qwen3-4b
gemma3-4b
```

## What Counts As Vision-Capable

The harness runs each deterministic image test twice: with the image and without the image. A model only counts as vision-capable if it answers the image-grounded tests correctly and clearly beats the no-image control.

The probe stores runs and results in:

```text
.data/vision-probe.db
```

Small settings live in:

```text
.data/settings.json
```

## Scripts

- `npm run generate-fixtures` creates deterministic PNG test images.
- `npm run download-model` downloads the configured GGUF and mmproj files into `.data/models/`.
- `npm run download-embedding` downloads the MiniLM embedding GGUF for semantic memory.
- `npm run list-models` shows configured probe models and download state.
- `npm run print-server-command` prints the local `llama-server` command for a downloaded model.
- `npm run chat` runs one persistent chat turn with app-style context and memory.
- `npm run memory-report` prints persistent chat and memory counts.
- `npm run probe` runs image and no-image controls against a running llama-server.
- `npm run report` prints the latest run verdict.
- `npm run test` runs harness unit tests.
- `npm run typecheck` validates the TypeScript package.
