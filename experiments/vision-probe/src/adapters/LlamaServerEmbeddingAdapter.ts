interface EmbeddingResponse {
  data?: Array<{
    embedding?: unknown;
  }>;
  embedding?: unknown;
  error?: {
    message?: string;
  };
}

export class LlamaServerEmbeddingAdapter {
  constructor(
    private readonly serverUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async initialize(): Promise<void> {
    await this.verifyServer();
  }

  isReady(): boolean {
    return Boolean(this.serverUrl.trim());
  }

  async verifyServer(): Promise<void> {
    const base = this.serverUrl.replace(/\/+$/, '');
    try {
      const health = await this.fetchImpl(`${base}/health`, { signal: AbortSignal.timeout(5_000) });
      if (health.ok) return;
    } catch {
      // Older llama-server builds may not expose /health.
    }

    const models = await this.fetchImpl(`${base}/v1/models`, { signal: AbortSignal.timeout(5_000) });
    if (!models.ok) {
      throw new Error(`embedding llama-server is not reachable. /v1/models returned HTTP ${models.status}.`);
    }
  }

  async embed(text: string, timeoutMs = 30_000): Promise<number[]> {
    const response = await this.fetchImpl(`${this.serverUrl.replace(/\/+$/, '')}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'local-embedding-model',
        input: text.slice(0, 1800),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const raw = await response.text();
    let parsed: EmbeddingResponse;
    try {
      parsed = JSON.parse(raw) as EmbeddingResponse;
    } catch {
      throw new Error(`Invalid JSON from embedding server: ${raw.slice(0, 500)}`);
    }

    if (!response.ok) {
      throw new Error(parsed.error?.message ?? `embedding server returned HTTP ${response.status}: ${raw.slice(0, 500)}`);
    }

    const embedding = parsed.data?.[0]?.embedding ?? parsed.embedding;
    if (!Array.isArray(embedding)) return [];
    return embedding.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  }
}
