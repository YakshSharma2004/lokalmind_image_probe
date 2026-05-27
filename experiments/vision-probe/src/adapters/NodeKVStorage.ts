import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { VisionProbeSettings } from '../types.js';

export class NodeKVStorage {
  constructor(private readonly filePath: string) {}

  async read(): Promise<VisionProbeSettings> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as VisionProbeSettings;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  }

  async write(settings: VisionProbeSettings): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  }

  async merge(settings: VisionProbeSettings): Promise<void> {
    const current = await this.read();
    await this.write({
      ...current,
      ...settings,
      localModelPaths: {
        ...(current.localModelPaths ?? {}),
        ...(settings.localModelPaths ?? {}),
      },
      downloadedModels: {
        ...(current.downloadedModels ?? {}),
        ...(settings.downloadedModels ?? {}),
      },
      memorySettings: {
        ...(current.memorySettings ?? {}),
        ...(settings.memorySettings ?? {}),
        modeSystemPromptOverrides: {
          ...(current.memorySettings?.modeSystemPromptOverrides ?? {}),
          ...(settings.memorySettings?.modeSystemPromptOverrides ?? {}),
        },
      },
    });
  }
}
