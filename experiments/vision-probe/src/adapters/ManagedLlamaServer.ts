import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import type { DownloadedModelState, ModelArtifact } from '../types.js';

export interface ServerCommandOptions {
  llamaServerBin: string;
  artifact: ModelArtifact;
  downloaded: DownloadedModelState;
  port: number;
  contextSize: number;
}

export interface ManagedLlamaServerHandle {
  serverUrl: string;
  command: string;
  stop(): Promise<void>;
}

export interface EmbeddingServerCommandOptions {
  llamaServerBin: string;
  modelPath: string;
  port: number;
  contextSize: number;
  pooling: 'mean' | 'cls';
}

export function buildLlamaServerArgs(options: Omit<ServerCommandOptions, 'llamaServerBin'>): string[] {
  const args = [
    '-m',
    options.downloaded.modelPath,
    '-c',
    String(options.contextSize),
    '--host',
    '127.0.0.1',
    '--port',
    String(options.port),
  ];

  if (options.artifact.requiresMmproj) {
    if (!options.downloaded.mmprojPath) {
      throw new Error(`Model "${options.artifact.id}" requires an mmproj file. Re-run download-model for this model.`);
    }
    args.push('--mmproj', options.downloaded.mmprojPath);
  }

  return args;
}

export function formatCommand(binary: string, args: string[]): string {
  return [binary, ...args].map(quoteArg).join(' ');
}

export function buildEmbeddingServerArgs(options: Omit<EmbeddingServerCommandOptions, 'llamaServerBin'>): string[] {
  return [
    '-m',
    options.modelPath,
    '--embedding',
    '--pooling',
    options.pooling,
    '-c',
    String(options.contextSize),
    '--host',
    '127.0.0.1',
    '--port',
    String(options.port),
  ];
}

function quoteArg(value: string): string {
  return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

export async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'object' && address !== null) {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Failed to allocate a local port.')));
      }
    });
  });
}

export async function startManagedLlamaServer(
  options: ServerCommandOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<ManagedLlamaServerHandle> {
  const args = buildLlamaServerArgs(options);
  const command = formatCommand(options.llamaServerBin, args);
  const child = spawnServerProcess(options.llamaServerBin, args, command);

  const logs: string[] = [];
  const appendLog = (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    logs.push(text);
    while (logs.length > 30) logs.shift();
  };
  child.stdout?.on('data', appendLog);
  child.stderr?.on('data', appendLog);

  const serverUrl = `http://127.0.0.1:${options.port}`;
  await waitForServerHealthy(serverUrl, child, logs, fetchImpl, options.llamaServerBin, command);

  return {
    serverUrl,
    command,
    async stop() {
      await stopChild(child);
    },
  };
}

export async function startManagedEmbeddingServer(
  options: EmbeddingServerCommandOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<ManagedLlamaServerHandle> {
  const args = buildEmbeddingServerArgs(options);
  const command = formatCommand(options.llamaServerBin, args);
  const child = spawnServerProcess(options.llamaServerBin, args, command);

  const logs: string[] = [];
  const appendLog = (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    logs.push(text);
    while (logs.length > 30) logs.shift();
  };
  child.stdout?.on('data', appendLog);
  child.stderr?.on('data', appendLog);

  const serverUrl = `http://127.0.0.1:${options.port}`;
  await waitForServerHealthy(serverUrl, child, logs, fetchImpl, options.llamaServerBin, command);

  return {
    serverUrl,
    command,
    async stop() {
      await stopChild(child);
    },
  };
}

function spawnServerProcess(binary: string, args: string[], command: string): ChildProcess {
  try {
    return spawn(binary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(formatSpawnError(binary, command, error instanceof Error ? error : new Error(String(error))));
  }
}

async function waitForServerHealthy(
  serverUrl: string,
  child: ChildProcess,
  logs: string[],
  fetchImpl: typeof fetch,
  binary: string,
  command: string,
): Promise<void> {
  const deadline = Date.now() + 120_000;
  let exitCode: number | null = null;
  let spawnError: Error | null = null;
  child.once('exit', (code) => {
    exitCode = code;
  });
  child.once('error', (error) => {
    spawnError = error;
  });

  while (Date.now() < deadline) {
    if (spawnError) {
      throw new Error(formatSpawnError(binary, command, spawnError));
    }
    if (exitCode !== null) {
      throw new Error(`llama-server exited before becoming healthy (code ${exitCode}).\n${logs.join('')}`);
    }
    if (await isHealthy(serverUrl, fetchImpl)) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  await stopChild(child);
  throw new Error(`Timed out waiting for llama-server at ${serverUrl}.\n${logs.join('')}`);
}

function formatSpawnError(binary: string, command: string, error: Error): string {
  const code = 'code' in error ? String(error.code) : '';
  if (code === 'ENOENT') {
    return [
      `Could not start "${binary}" because it was not found on PATH.`,
      'Install llama.cpp/llama-server, or pass the full executable path with:',
      `  --llama-server-bin "C:\\path\\to\\llama-server.exe"`,
      '',
      `Command attempted: ${command}`,
    ].join('\n');
  }
  if (code === 'EPERM') {
    return [
      `Could not start "${binary}" because Node was not allowed to spawn the process.`,
      'This can happen in restricted terminals even when PowerShell can run the exe directly.',
      'Use manual server mode: start llama-server in separate PowerShell windows, then run the CLI with --server and --embedding-server instead of --auto-server.',
      '',
      `Command attempted: ${command}`,
    ].join('\n');
  }
  return `Could not start "${binary}": ${error.message}\nCommand attempted: ${command}`;
}

async function isHealthy(serverUrl: string, fetchImpl: typeof fetch): Promise<boolean> {
  const base = serverUrl.replace(/\/+$/, '');
  try {
    const health = await fetchImpl(`${base}/health`, { signal: AbortSignal.timeout(2_000) });
    if (health.ok) return true;
  } catch {
    // Older builds may not expose /health.
  }

  try {
    const models = await fetchImpl(`${base}/v1/models`, { signal: AbortSignal.timeout(2_000) });
    return models.ok;
  } catch {
    return false;
  }
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        child.kill('SIGKILL');
      }
      resolve();
    }, 5_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}
