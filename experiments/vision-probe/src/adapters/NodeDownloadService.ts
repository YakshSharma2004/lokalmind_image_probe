import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { dirname } from 'node:path';

export interface DownloadProgress {
  bytesWritten: number;
  totalBytes: number | null;
  progressFraction: number | null;
}

export interface DownloadFileOptions {
  expectedBytes?: number;
  force?: boolean;
  onProgress?: (progress: DownloadProgress) => void;
}

export interface DownloadFileResult {
  destinationPath: string;
  bytesWritten: number;
  skipped: boolean;
}

export class NodeDownloadService {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async downloadFile(
    url: string,
    destinationPath: string,
    options: DownloadFileOptions = {},
  ): Promise<DownloadFileResult> {
    await mkdir(dirname(destinationPath), { recursive: true });
    const existing = await this.getFileSize(destinationPath);
    if (existing !== null && !options.force) {
      if (options.expectedBytes !== undefined && existing !== options.expectedBytes) {
        throw new Error(
          `Existing file size mismatch for ${destinationPath}: expected ${options.expectedBytes}, got ${existing}. Use --force to re-download.`,
        );
      }
      return { destinationPath, bytesWritten: existing, skipped: true };
    }

    const partialPath = `${destinationPath}.partial`;
    await rm(partialPath, { force: true });

    const response = await this.fetchImpl(url);
    if (!response.ok || !response.body) {
      throw new Error(`Download failed: HTTP ${response.status} ${response.statusText}`);
    }

    const totalHeader = response.headers.get('content-length');
    const totalBytes = totalHeader ? Number.parseInt(totalHeader, 10) : null;
    let bytesWritten = 0;

    const partialFile = createWriteStream(partialPath);
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytesWritten += value.byteLength;
        options.onProgress?.({
          bytesWritten,
          totalBytes,
          progressFraction: totalBytes && totalBytes > 0 ? Math.min(bytesWritten / totalBytes, 1) : null,
        });
        if (!partialFile.write(Buffer.from(value))) {
          await once(partialFile, 'drain');
        }
      }
      partialFile.end();
      await once(partialFile, 'finish');

      if (options.expectedBytes !== undefined && bytesWritten !== options.expectedBytes) {
        await rm(partialPath, { force: true });
        throw new Error(`Downloaded size mismatch for ${destinationPath}: expected ${options.expectedBytes}, got ${bytesWritten}.`);
      }

      await rm(destinationPath, { force: true });
      await rename(partialPath, destinationPath);
      return { destinationPath, bytesWritten, skipped: false };
    } catch (error) {
      partialFile.destroy();
      await rm(partialPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async getFileSize(path: string): Promise<number | null> {
    try {
      return (await stat(path)).size;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }
}
