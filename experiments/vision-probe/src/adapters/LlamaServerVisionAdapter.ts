import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { ProbeMessage, ProbeRequestConfig, ProbeResponse } from '../types.js';

type OpenAITextContent = {
  type: 'text';
  text: string;
};

type OpenAIImageContent = {
  type: 'image_url';
  image_url: {
    url: string;
  };
};

type OpenAIMessage =
  | {
      role: ProbeMessage['role'];
      content: string;
    }
  | {
      role: ProbeMessage['role'];
      content: Array<OpenAITextContent | OpenAIImageContent>;
    };

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  error?: {
    message?: string;
  };
}

export function mimeTypeForPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

export async function imagePathToDataUrl(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return `data:${mimeTypeForPath(filePath)};base64,${bytes.toString('base64')}`;
}

export class LlamaServerVisionAdapter {
  constructor(
    private readonly serverUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async initialize(): Promise<void> {
    await this.verifyServer();
  }

  async unloadModel(): Promise<void> {
    // llama-server owns model lifetime in this desktop experiment.
  }

  async verifyServer(): Promise<void> {
    const healthUrl = `${this.serverUrl.replace(/\/+$/, '')}/health`;
    const modelsUrl = `${this.serverUrl.replace(/\/+$/, '')}/v1/models`;

    try {
      const health = await this.fetchImpl(healthUrl, { signal: AbortSignal.timeout(5_000) });
      if (health.ok) return;
    } catch {
      // Some llama-server builds do not expose /health. Fall through to /v1/models.
    }

    const models = await this.fetchImpl(modelsUrl, { signal: AbortSignal.timeout(5_000) });
    if (!models.ok) {
      throw new Error(`llama-server is not reachable. /v1/models returned HTTP ${models.status}.`);
    }
  }

  async generateResponse(
    messages: ProbeMessage[],
    config: ProbeRequestConfig,
  ): Promise<ProbeResponse> {
    const started = Date.now();
    const payload = {
      model: config.model,
      messages: await Promise.all(messages.map((message) => this.toOpenAIMessage(message))),
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      stream: false,
    };

    const response = await this.fetchImpl(`${this.serverUrl.replace(/\/+$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(config.timeoutMs),
    });

    const raw = await response.text();
    let parsed: ChatCompletionResponse;
    try {
      parsed = JSON.parse(raw) as ChatCompletionResponse;
    } catch {
      throw new Error(`Invalid JSON from llama-server: ${raw.slice(0, 500)}`);
    }

    if (!response.ok) {
      throw new Error(parsed.error?.message ?? `llama-server returned HTTP ${response.status}: ${raw.slice(0, 500)}`);
    }

    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('llama-server response did not include choices[0].message.content as a string.');
    }

    return {
      text: content,
      latencyMs: Date.now() - started,
    };
  }

  async toOpenAIMessage(message: ProbeMessage): Promise<OpenAIMessage> {
    if (!message.imagePath) {
      return { role: message.role, content: message.content };
    }

    return {
      role: message.role,
      content: [
        { type: 'text', text: message.content },
        { type: 'image_url', image_url: { url: await imagePathToDataUrl(message.imagePath) } },
      ],
    };
  }
}
