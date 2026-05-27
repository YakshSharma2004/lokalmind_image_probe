import { resolve } from 'node:path';
import { modelsDir } from '../config.js';
import type { DownloadedModelState, ModelArtifact, VisionProbeSettings } from '../types.js';

const appCatalogModels = [
  {
    id: 'qwen3.5-0.8b',
    label: 'Qwen 3.5 - 0.8B',
    filename: 'Qwen_Qwen3.5-0.8B-Q4_K_M.gguf',
    sizeBytes: 549_916_416,
    contextSize: 32_768,
    notes: 'App catalog Qwen text model. Included so the probe can verify whether image payloads are rejected or ignored.',
  },
  {
    id: 'qwen3.5-2b',
    label: 'Qwen 3.5 - 2B',
    filename: 'Qwen_Qwen3.5-2B-Q4_K_M.gguf',
    sizeBytes: 1_315_634_944,
    contextSize: 32_768,
    notes: 'App catalog Qwen text model. Included so the probe can verify whether image payloads are rejected or ignored.',
  },
  {
    id: 'deepseek-r1-1.5b',
    label: 'DeepSeek R1 - 1.5B',
    filename: 'DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf',
    sizeBytes: 1_117_320_800,
    contextSize: 32_768,
    notes: 'App catalog DeepSeek reasoning model. Included as a text-model control for the image probe.',
  },
  {
    id: 'qwen3.5-4b',
    label: 'Qwen 3.5 - 4B',
    filename: 'Qwen_Qwen3.5-4B-Q4_K_M.gguf',
    sizeBytes: 2_856_936_448,
    contextSize: 32_768,
    notes: 'App catalog Qwen text model. Included so the probe can verify whether image payloads are rejected or ignored.',
  },
  {
    id: 'qwen3-4b',
    label: 'Qwen 3 - 4B',
    filename: 'Qwen_Qwen3-4B-Q4_K_M.gguf',
    sizeBytes: 2_497_280_960,
    contextSize: 32_768,
    notes: 'App catalog Qwen reasoning model. Included so the probe can verify whether image payloads are rejected or ignored.',
  },
  {
    id: 'gemma3-4b',
    label: 'Gemma 3 - 4B',
    filename: 'google_gemma-3-4b-it-Q4_K_M.gguf',
    sizeBytes: 2_489_758_720,
    contextSize: 32_768,
    notes: 'App catalog Gemma 3 text setup. This entry does not configure an mmproj, so it is treated as text-only unless the GGUF itself works with image payloads.',
  },
] as const;

function appCatalogArtifact(model: typeof appCatalogModels[number]): ModelArtifact {
  return {
    ...model,
    modelCdnPath: `models/${model.id}/${model.filename}`,
    requiresMmproj: false,
  };
}

export const modelArtifacts: Record<string, ModelArtifact> = {
  'gemma3-4b-vision': {
    id: 'gemma3-4b-vision',
    label: 'ggml-org/gemma-3-4b-it-GGUF Q4_K_M',
    repoId: 'ggml-org/gemma-3-4b-it-GGUF',
    filename: 'gemma-3-4b-it-Q4_K_M.gguf',
    modelUrl: 'https://huggingface.co/ggml-org/gemma-3-4b-it-GGUF/resolve/main/gemma-3-4b-it-Q4_K_M.gguf',
    mmprojFilename: 'mmproj-model-f16.gguf',
    mmprojUrl: 'https://huggingface.co/ggml-org/gemma-3-4b-it-GGUF/resolve/main/mmproj-model-f16.gguf',
    requiresMmproj: true,
    contextSize: 8192,
    notes: 'Primary vision probe model. Requires the mmproj file for image input.',
  },
  'smolvlm-256m-vision': {
    id: 'smolvlm-256m-vision',
    label: 'ggml-org/SmolVLM-256M-Instruct-GGUF Q8_0',
    repoId: 'ggml-org/SmolVLM-256M-Instruct-GGUF',
    filename: 'SmolVLM-256M-Instruct-Q8_0.gguf',
    modelUrl: 'https://huggingface.co/ggml-org/SmolVLM-256M-Instruct-GGUF/resolve/main/SmolVLM-256M-Instruct-Q8_0.gguf',
    sizeBytes: 175_054_528,
    mmprojFilename: 'mmproj-SmolVLM-256M-Instruct-Q8_0.gguf',
    mmprojUrl: 'https://huggingface.co/ggml-org/SmolVLM-256M-Instruct-GGUF/resolve/main/mmproj-SmolVLM-256M-Instruct-Q8_0.gguf',
    mmprojSizeBytes: 103_769_856,
    requiresMmproj: true,
    contextSize: 2048,
    notes: 'Small vision model for quick smoke tests. Requires the matching Q8_0 mmproj file for image input.',
  },
  'smolvlm2-2.2b-vision': {
    id: 'smolvlm2-2.2b-vision',
    label: 'ggml-org/SmolVLM2-2.2B-Instruct-GGUF Q4_K_M',
    repoId: 'ggml-org/SmolVLM2-2.2B-Instruct-GGUF',
    filename: 'SmolVLM2-2.2B-Instruct-Q4_K_M.gguf',
    modelUrl: 'https://huggingface.co/ggml-org/SmolVLM2-2.2B-Instruct-GGUF/resolve/main/SmolVLM2-2.2B-Instruct-Q4_K_M.gguf',
    sizeBytes: 1_112_602_656,
    mmprojFilename: 'mmproj-SmolVLM2-2.2B-Instruct-f16.gguf',
    mmprojUrl: 'https://huggingface.co/ggml-org/SmolVLM2-2.2B-Instruct-GGUF/resolve/main/mmproj-SmolVLM2-2.2B-Instruct-f16.gguf',
    mmprojSizeBytes: 872_303_680,
    requiresMmproj: true,
    contextSize: 4096,
    notes: 'Balanced open vision model candidate. Requires the matching f16 mmproj file for image input.',
  },
  'qwen2.5-vl-3b-vision': {
    id: 'qwen2.5-vl-3b-vision',
    label: 'ggml-org/Qwen2.5-VL-3B-Instruct-GGUF Q4_K_M',
    repoId: 'ggml-org/Qwen2.5-VL-3B-Instruct-GGUF',
    filename: 'Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf',
    modelUrl: 'https://huggingface.co/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf',
    sizeBytes: 1_929_901_056,
    mmprojFilename: 'mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf',
    mmprojUrl: 'https://huggingface.co/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf',
    mmprojSizeBytes: 844_757_728,
    requiresMmproj: true,
    contextSize: 8192,
    notes: 'Qwen vision-language candidate. Requires the matching Q8_0 mmproj file for image input.',
  },
  ...Object.fromEntries(appCatalogModels.map((model) => [model.id, appCatalogArtifact(model)])),
};

export const embeddingArtifact: ModelArtifact = {
  id: 'all-minilm-l6-v2',
  label: 'MiniLM Embedding Model',
  filename: 'all-MiniLM-L6-v2-Q4_K_M.gguf',
  modelCdnPath: 'models/all-MiniLM-L6/all-MiniLM-L6-v2-Q4_K_M.gguf',
  sizeBytes: 20_999_104,
  requiresMmproj: false,
  contextSize: 512,
  notes: 'App embedding model used for semantic memory retrieval.',
};

export function resolveModelUrl(artifact: ModelArtifact): string {
  if (artifact.modelUrl) return artifact.modelUrl;

  if (artifact.modelCdnPath) {
    const baseUrl = (
      process.env.VISION_PROBE_MODEL_BASE_URL ??
      process.env.HETZNER_BASE_URL ??
      process.env.HETZNER_WEBDAV_URL ??
      ''
    ).trim().replace(/\/+$/, '');

    if (!baseUrl) {
      throw new Error(
        `Model "${artifact.id}" uses the app model CDN. Set VISION_PROBE_MODEL_BASE_URL or HETZNER_BASE_URL before running download-model.`,
      );
    }

    return `${baseUrl}/${artifact.modelCdnPath}`;
  }

  throw new Error(`Model "${artifact.id}" does not have a download URL configured.`);
}

export function getModelArtifact(modelId: string): ModelArtifact {
  const artifact = modelArtifacts[modelId];
  if (!artifact) {
    throw new Error(`Unknown downloadable model "${modelId}". Run list-models to see available ids.`);
  }
  return artifact;
}

export function modelArtifactDir(modelId: string): string {
  return resolve(modelsDir, modelId);
}

export function modelArtifactPath(artifact: ModelArtifact): string {
  return resolve(modelArtifactDir(artifact.id), artifact.filename);
}

export function mmprojArtifactPath(artifact: ModelArtifact): string | null {
  return artifact.mmprojFilename ? resolve(modelArtifactDir(artifact.id), artifact.mmprojFilename) : null;
}

export function embeddingArtifactPath(): string {
  return modelArtifactPath(embeddingArtifact);
}

export function resolveDownloadedModel(settings: VisionProbeSettings, modelId: string): DownloadedModelState {
  const downloaded = settings.downloadedModels?.[modelId];
  if (!downloaded) {
    throw new Error(`Model "${modelId}" is not downloaded. Run: npm run download-model -- --model ${modelId}`);
  }
  return downloaded;
}

export function resolveDownloadedEmbedding(settings: VisionProbeSettings): DownloadedModelState {
  const downloaded = settings.downloadedEmbeddingModel;
  if (!downloaded) {
    throw new Error('Embedding model is not downloaded. Run: npm run download-embedding');
  }
  return downloaded;
}
