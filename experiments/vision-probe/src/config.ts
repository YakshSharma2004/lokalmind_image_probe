import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const packageRoot = resolve(here, '..');

export const dataDir = resolve(packageRoot, '.data');
export const defaultFixtureDir = resolve(dataDir, 'fixtures');
export const defaultDbPath = resolve(dataDir, 'vision-probe.db');
export const defaultSettingsPath = resolve(dataDir, 'settings.json');
export const modelsDir = resolve(dataDir, 'models');

export const persistentChatSessionId = 'persistent_chat';
export const persistentChatTitle = 'Persistent Chat';

export const defaultProbeConfig = {
  serverUrl: 'http://127.0.0.1:8080',
  temperature: 0,
  maxTokens: 128,
  timeoutMs: 120_000,
} as const;

export const modelCandidates: Record<string, { label: string; notes: string }> = {
  'gemma3-4b-vision': {
    label: 'ggml-org/gemma-3-4b-it-GGUF',
    notes: 'Primary llama.cpp multimodal candidate. Can be downloaded locally and launched with llama-server.',
  },
  'gemma3-4b-app-local': {
    label: 'Existing app Gemma 3 4B local GGUF',
    notes: 'Only vision-capable if paired with the correct multimodal projector.',
  },
  'qwen-text-app-local': {
    label: 'Existing app Qwen text GGUF',
    notes: 'Expected text-only unless replaced with a Qwen VL/Omni model plus projector.',
  },
  'deepseek-text-app-local': {
    label: 'Existing app DeepSeek text GGUF',
    notes: 'Expected text-only unless replaced with a multimodal model plus projector.',
  },
};
