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
    finish_reason?: unknown;
    message?: {
      content?: unknown;
      role?: unknown;
    };
  }>;
  error?: {
    message?: string;
  };
  usage?: unknown;
}

export type LlamaServerDebugLogger = (message: string) => void;

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
    private readonly debugLog?: LlamaServerDebugLogger,
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
      this.debug(`[llama] GET ${healthUrl}`);
      const health = await this.fetchImpl(healthUrl, { signal: AbortSignal.timeout(5_000) });
      this.debug(`[llama] /health HTTP ${health.status}`);
      if (health.ok) return;
    } catch {
      this.debug('[llama] /health unavailable; trying /v1/models');
      // Some llama-server builds do not expose /health. Fall through to /v1/models.
    }

    this.debug(`[llama] GET ${modelsUrl}`);
    const models = await this.fetchImpl(modelsUrl, { signal: AbortSignal.timeout(5_000) });
    this.debug(`[llama] /v1/models HTTP ${models.status}`);
    if (!models.ok) {
      throw new Error(`llama-server is not reachable. /v1/models returned HTTP ${models.status}.`);
    }
  }

  async generateResponse(
    messages: ProbeMessage[],
    config: ProbeRequestConfig,
  ): Promise<ProbeResponse> {
    const started = Date.now();
    const openAiMessages = await Promise.all(messages.map((message) => this.toOpenAIMessage(message)));
    const payload = {
      model: config.model,
      messages: openAiMessages,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      stream: false,
    };
    const url = `${this.serverUrl.replace(/\/+$/, '')}/v1/chat/completions`;

    this.debug(
      `[llama] POST ${url} model=${config.model} messages=${openAiMessages.length} ` +
      `temperature=${config.temperature} max_tokens=${config.maxTokens} timeout_ms=${config.timeoutMs}`,
    );
    openAiMessages.forEach((message, index) => {
      this.debug(`[llama] request message ${index + 1}: ${summarizeOpenAIMessage(message)}`);
    });

    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(config.timeoutMs),
    });

    const raw = await response.text();
    this.debug(`[llama] HTTP ${response.status} ${response.statusText} latency_ms=${Date.now() - started} raw_chars=${raw.length}`);
    this.debug(`[llama] raw preview: ${preview(raw, 1_000)}`);

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
    this.debug(
      `[llama] parsed choices=${parsed.choices?.length ?? 0} ` +
      `finish_reason=${String(parsed.choices?.[0]?.finish_reason ?? '(missing)')} ` +
      `content_type=${typeof content} content_chars=${typeof content === 'string' ? content.length : '(n/a)'} ` +
      `trimmed_chars=${typeof content === 'string' ? content.trim().length : '(n/a)'}`,
    );
    if (typeof content !== 'string') {
      throw new Error('llama-server response did not include choices[0].message.content as a string.');
    }
    if (content.trim().length === 0) {
      this.debug('[llama] WARNING: llama-server returned an empty or whitespace-only assistant message.');
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

  private debug(message: string): void {
    this.debugLog?.(message);
  }
}

function summarizeOpenAIMessage(message: OpenAIMessage): string {
  if (typeof message.content === 'string') {
    return `role=${message.role} text_chars=${message.content.length} preview="${preview(message.content, 220)}"`;
  }

  const parts = message.content.map((part) => {
    if (part.type === 'text') return `text_chars=${part.text.length}`;
    return `image_url_chars=${part.image_url.url.length}`;
  });
  return `role=${message.role} multimodal_parts=${message.content.length} ${parts.join(' ')}`;
}

function preview(value: string, maxLength: number): string {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength)}...`;
}
