import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  defaultDbPath,
  defaultFixtureDir,
  defaultProbeConfig,
  defaultSettingsPath,
  modelCandidates,
  persistentChatSessionId,
} from './config.js';
import { LlamaServerVisionAdapter } from './adapters/LlamaServerVisionAdapter.js';
import { LlamaServerEmbeddingAdapter } from './adapters/LlamaServerEmbeddingAdapter.js';
import {
  buildEmbeddingServerArgs,
  buildLlamaServerArgs,
  formatCommand,
  getFreePort,
  startManagedEmbeddingServer,
  startManagedLlamaServer,
  type ManagedLlamaServerHandle,
} from './adapters/ManagedLlamaServer.js';
import { NodeDownloadService } from './adapters/NodeDownloadService.js';
import { NodeKVStorage } from './adapters/NodeKVStorage.js';
import { NodeSQLiteDriver } from './adapters/NodeSQLiteDriver.js';
import { initializeSchema } from './data/schema.js';
import { VisionProbeRepository } from './data/VisionProbeRepository.js';
import { DesktopAppSettingsRepository } from './data/DesktopAppSettingsRepository.js';
import { DesktopMemoryRepository } from './data/DesktopMemoryRepository.js';
import { PersistentChatRepository } from './data/PersistentChatRepository.js';
import { isChatMode } from './domain/appContext.js';
import { buildProbeContext } from './domain/buildProbeContext.js';
import { DesktopMemoryService } from './domain/DesktopMemoryService.js';
import {
  embeddingArtifact,
  embeddingArtifactPath,
  getModelArtifact,
  mmprojArtifactPath,
  modelArtifactPath,
  modelArtifacts,
  resolveDownloadedEmbedding,
  resolveModelUrl,
  resolveDownloadedModel,
} from './domain/modelArtifacts.js';
import { runPersistentChatTurn } from './domain/runPersistentChatTurn.js';
import { scoreVisionAnswer } from './domain/scoreVisionAnswer.js';
import { testCases } from './domain/testCases.js';
import type { ChatMode, DownloadedModelState, ModelArtifact, ProbeResultRecord, ProbeRun, TestCase } from './types.js';

interface ParsedArgs {
  command:
    | 'probe'
    | 'report'
    | 'download-model'
    | 'download-embedding'
    | 'list-models'
    | 'print-server-command'
    | 'chat'
    | 'memory-report'
    | 'help';
  model?: string;
  message?: string;
  mode?: ChatMode;
  server?: string;
  embeddingServer?: string;
  fixtures?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  serverCommand?: string;
  withAppContext?: boolean;
  autoServer?: boolean;
  autoEmbeddingServer?: boolean;
  noEmbeddings?: boolean;
  llamaServerBin?: string;
  port?: number;
  embeddingPort?: number;
  embeddingPooling?: 'mean' | 'cls';
  contextSize?: number;
  keepServerAlive?: boolean;
  force?: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [commandRaw, ...rest] = argv;
  const command =
    commandRaw === 'probe' ||
    commandRaw === 'report' ||
    commandRaw === 'download-model' ||
    commandRaw === 'download-embedding' ||
    commandRaw === 'list-models' ||
    commandRaw === 'print-server-command' ||
    commandRaw === 'chat' ||
    commandRaw === 'memory-report'
      ? commandRaw
      : 'help';
  const args: ParsedArgs = { command };

  for (let i = 0; i < rest.length; i++) {
    const key = rest[i];
    const next = rest[i + 1];
    if (!key) continue;

    switch (key) {
      case '--model':
        if (!next) throw new Error('--model requires a value');
        args.model = next;
        i++;
        break;
      case '--message':
        if (!next) throw new Error('--message requires a value');
        args.message = next;
        i++;
        break;
      case '--mode':
        if (!next) throw new Error('--mode requires a value');
        if (!isChatMode(next)) throw new Error('--mode must be one of: general, coding, creative, marketing');
        args.mode = next;
        i++;
        break;
      case '--server':
        if (!next) throw new Error('--server requires a value');
        args.server = next;
        i++;
        break;
      case '--embedding-server':
        if (!next) throw new Error('--embedding-server requires a value');
        args.embeddingServer = next;
        i++;
        break;
      case '--fixtures':
        if (!next) throw new Error('--fixtures requires a value');
        args.fixtures = next;
        i++;
        break;
      case '--temperature':
        if (!next) throw new Error('--temperature requires a value');
        args.temperature = Number.parseFloat(next);
        i++;
        break;
      case '--max-tokens':
        if (!next) throw new Error('--max-tokens requires a value');
        args.maxTokens = Number.parseInt(next, 10);
        i++;
        break;
      case '--timeout-ms':
        if (!next) throw new Error('--timeout-ms requires a value');
        args.timeoutMs = Number.parseInt(next, 10);
        i++;
        break;
      case '--server-command':
        if (!next) throw new Error('--server-command requires a value');
        args.serverCommand = next;
        i++;
        break;
      case '--auto-server':
        args.autoServer = true;
        break;
      case '--auto-embedding-server':
        args.autoEmbeddingServer = true;
        break;
      case '--no-embeddings':
        args.noEmbeddings = true;
        break;
      case '--llama-server-bin':
        if (!next) throw new Error('--llama-server-bin requires a value');
        args.llamaServerBin = next;
        i++;
        break;
      case '--port':
        if (!next) throw new Error('--port requires a value');
        args.port = Number.parseInt(next, 10);
        i++;
        break;
      case '--embedding-port':
        if (!next) throw new Error('--embedding-port requires a value');
        args.embeddingPort = Number.parseInt(next, 10);
        i++;
        break;
      case '--embedding-pooling':
        if (!next) throw new Error('--embedding-pooling requires a value');
        if (next !== 'mean' && next !== 'cls') throw new Error('--embedding-pooling must be mean or cls');
        args.embeddingPooling = next;
        i++;
        break;
      case '--context-size':
        if (!next) throw new Error('--context-size requires a value');
        args.contextSize = Number.parseInt(next, 10);
        i++;
        break;
      case '--keep-server-alive':
        args.keepServerAlive = true;
        break;
      case '--force':
        args.force = true;
        break;
      case '--with-app-context':
        args.withAppContext = true;
        break;
      default:
        throw new Error(`Unknown option: ${key}`);
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`LokalMind Vision Probe

Commands:
  npm run list-models
  npm run download-model -- --model <id> [--force]
  npm run download-embedding [--force]
  npm run print-server-command -- --model <id> [--llama-server-bin <path>] [--port <number>]
  npm run chat -- --model <id> --message <text> --auto-server [options]
  npm run probe -- --model <id> --server <url> [options]
  npm run probe -- --model <id> --auto-server [options]
  npm run report
  npm run memory-report

Options:
  --message <text>        One-shot persistent chat message
  --mode <mode>           general | coding | creative | marketing. Default: general
  --fixtures <path>        Fixture directory. Default: .data/fixtures
  --temperature <number>   Default: 0
  --max-tokens <number>    Default: 128
  --timeout-ms <number>    Default: 120000
  --server-command <text>  Optional command used to start llama-server
  --auto-server            Spawn llama-server from downloaded model files
  --llama-server-bin <bin> Default: llama-server
  --port <number>          Default: auto-pick a free local port
  --embedding-server <url> Use an existing embedding llama-server
  --auto-embedding-server  Spawn embedding llama-server from downloaded MiniLM
  --embedding-port <num>   Default: auto-pick a free local port
  --embedding-pooling <p>  mean | cls. Default: mean
  --no-embeddings          Force score-based memory retrieval
  --context-size <number>  Default: model registry value or 8192
  --keep-server-alive      Leave spawned llama-server running after probe
  --with-app-context       Reserved for a follow-up mode; v1 probes stay deterministic

Recommended server:
  llama-server -hf ggml-org/gemma-3-4b-it-GGUF -c 8192 --port 8080
`);
}

function resolveFromCwd(path: string): string {
  return resolve(process.cwd(), path);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function createRepository(): Promise<{ driver: NodeSQLiteDriver; repository: VisionProbeRepository }> {
  const driver = new NodeSQLiteDriver(defaultDbPath);
  await driver.initialize();
  await initializeSchema(driver);
  return { driver, repository: new VisionProbeRepository(driver) };
}

async function createPersistentRepositories(): Promise<{
  driver: NodeSQLiteDriver;
  chatRepository: PersistentChatRepository;
  memoryRepository: DesktopMemoryRepository;
}> {
  const driver = new NodeSQLiteDriver(defaultDbPath);
  await driver.initialize();
  await initializeSchema(driver);
  return {
    driver,
    chatRepository: new PersistentChatRepository(driver),
    memoryRepository: new DesktopMemoryRepository(driver),
  };
}

function modelLabelFor(modelId: string): string {
  return modelArtifacts[modelId]?.label ?? modelCandidates[modelId]?.label ?? modelId;
}

function fixturePathFor(fixtureDir: string, testCase: TestCase): string {
  return resolve(fixtureDir, testCase.imageFile);
}

async function verifyFixtures(fixtureDir: string): Promise<void> {
  const missing: string[] = [];
  for (const testCase of testCases) {
    const imagePath = fixturePathFor(fixtureDir, testCase);
    if (!(await exists(imagePath))) {
      missing.push(imagePath);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing fixture(s):\n${missing.map((item) => `- ${item}`).join('\n')}\nRun: npm run generate-fixtures`,
    );
  }
}

async function runSingleProbe(params: {
  adapter: LlamaServerVisionAdapter;
  repository: VisionProbeRepository;
  runId: string;
  modelId: string;
  testCase: TestCase;
  imagePath: string;
  withImage: boolean;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}): Promise<void> {
  const messages = buildProbeContext(params.testCase, params.withImage ? params.imagePath : undefined);
  let responseText: string | null = null;
  let latencyMs: number | null = null;
  let errorText: string | null = null;

  try {
    const response = await params.adapter.generateResponse(messages, {
      model: params.modelId,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      timeoutMs: params.timeoutMs,
    });
    responseText = response.text;
    latencyMs = response.latencyMs;
  } catch (error) {
    errorText = error instanceof Error ? error.message : String(error);
  }

  const score = scoreVisionAnswer(params.testCase, responseText, errorText ?? undefined);
  await params.repository.saveResult({
    id: randomUUID(),
    runId: params.runId,
    testId: params.testCase.id,
    imagePath: params.imagePath,
    prompt: params.testCase.prompt,
    withImage: params.withImage,
    responseText,
    expectedSignals: JSON.stringify(params.testCase.expectedSignals),
    forbiddenSignals: JSON.stringify(params.testCase.forbiddenSignals),
    score: score.score,
    latencyMs,
    error: errorText,
    createdAt: Date.now(),
  });

  const marker = params.withImage ? 'image' : 'control';
  const suffix = errorText ? ` (${errorText.slice(0, 100)})` : '';
  console.log(`${params.testCase.id.padEnd(20)} ${marker.padEnd(8)} ${score.score}${suffix}`);
}

async function runProbe(args: ParsedArgs): Promise<number> {
  if (!args.model) throw new Error('--model is required');
  if (!args.server && !args.autoServer) throw new Error('probe requires either --server <url> or --auto-server');
  if (args.server && args.autoServer) throw new Error('Use either --server or --auto-server, not both.');
  if (args.withAppContext) {
    console.warn('--with-app-context is reserved for a follow-up mode. This run uses deterministic probe prompts.');
  }

  const fixtureDir = args.fixtures ? resolveFromCwd(args.fixtures) : defaultFixtureDir;
  const temperature = args.temperature ?? defaultProbeConfig.temperature;
  const maxTokens = args.maxTokens ?? defaultProbeConfig.maxTokens;
  const timeoutMs = args.timeoutMs ?? defaultProbeConfig.timeoutMs;

  await verifyFixtures(fixtureDir);

  const kv = new NodeKVStorage(defaultSettingsPath);
  const settings = await kv.read();
  let managedServer: ManagedLlamaServerHandle | null = null;
  let serverUrl = args.server ?? '';
  let serverCommand = args.serverCommand ?? null;

  if (args.autoServer) {
    const artifact = getModelArtifact(args.model);
    const downloaded = resolveDownloadedModel(settings, args.model);
    await verifyDownloadedFiles(artifact, downloaded);
    const port = args.port ?? await getFreePort();
    const contextSize = args.contextSize ?? artifact.contextSize;
    managedServer = await startManagedLlamaServer({
      llamaServerBin: args.llamaServerBin ?? 'llama-server',
      artifact,
      downloaded,
      port,
      contextSize,
    });
    serverUrl = managedServer.serverUrl;
    serverCommand = managedServer.command;
  }

  await kv.merge({
    serverUrl,
    lastModelId: args.model,
    lastFixtureDir: fixtureDir,
  });

  const { driver, repository } = await createRepository();
  const adapter = new LlamaServerVisionAdapter(serverUrl);
  const runId = randomUUID();
  try {
    await adapter.initialize();
    await repository.createRun({
      id: runId,
      modelId: args.model,
      modelLabel: modelLabelFor(args.model),
      serverUrl,
      serverCommand,
      startedAt: Date.now(),
      notes: modelArtifacts[args.model]?.notes ?? modelCandidates[args.model]?.notes ?? null,
    });

    console.log(`Run: ${runId}`);
    console.log(`Model: ${args.model} (${modelLabelFor(args.model)})`);
    console.log(`Server: ${serverUrl}`);
    if (serverCommand) console.log(`Command: ${serverCommand}`);
    console.log('');

    for (const testCase of testCases) {
      const imagePath = fixturePathFor(fixtureDir, testCase);
      await runSingleProbe({
        adapter,
        repository,
        runId,
        modelId: args.model,
        testCase,
        imagePath,
        withImage: true,
        temperature,
        maxTokens,
        timeoutMs,
      });
      await runSingleProbe({
        adapter,
        repository,
        runId,
        modelId: args.model,
        testCase,
        imagePath,
        withImage: false,
        temperature,
        maxTokens,
        timeoutMs,
      });
    }

    const results = await repository.getRunResults(runId);
    const { computeVisionVerdict } = await import('./domain/scoreVisionAnswer.js');
    const verdict = computeVisionVerdict(results);
    await repository.completeRun(runId, 'completed', verdict.explanation);
    console.log('');
    console.log(`Verdict: ${verdict.verdict}`);
    console.log(verdict.explanation);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await repository.completeRun(runId, 'failed', message);
    } catch {
      // Run row may not exist if server verification failed before createRun().
    }
    throw error;
  } finally {
    if (managedServer && !args.keepServerAlive) {
      await managedServer.stop();
    } else if (managedServer && args.keepServerAlive) {
      console.log(`Keeping llama-server alive at ${managedServer.serverUrl}`);
    }
    driver.close();
  }
}

function formatBytes(bytes: number): string {
  const mib = bytes / 1024 / 1024;
  if (mib < 1024) return `${mib.toFixed(1)} MB`;
  return `${(mib / 1024).toFixed(2)} GB`;
}

function createProgressPrinter(label: string): (progress: { bytesWritten: number; totalBytes: number | null; progressFraction: number | null }) => void {
  let lastPrint = 0;
  return (progress) => {
    const now = Date.now();
    if (now - lastPrint < 1_000 && progress.progressFraction !== 1) return;
    lastPrint = now;
    const total = progress.totalBytes ? `/${formatBytes(progress.totalBytes)}` : '';
    const pct = progress.progressFraction === null ? '' : ` ${(progress.progressFraction * 100).toFixed(1)}%`;
    console.log(`${label}: ${formatBytes(progress.bytesWritten)}${total}${pct}`);
  };
}

async function downloadArtifactFile(params: {
  service: NodeDownloadService;
  label: string;
  url: string;
  destinationPath: string;
  expectedBytes?: number;
  force?: boolean;
}): Promise<void> {
  const result = await params.service.downloadFile(params.url, params.destinationPath, {
    ...(params.expectedBytes !== undefined ? { expectedBytes: params.expectedBytes } : {}),
    ...(params.force !== undefined ? { force: params.force } : {}),
    onProgress: createProgressPrinter(params.label),
  });
  if (result.skipped) {
    console.log(`${params.label}: already downloaded at ${params.destinationPath}`);
  } else {
    console.log(`${params.label}: saved ${formatBytes(result.bytesWritten)} to ${params.destinationPath}`);
  }
}

async function runDownloadModel(args: ParsedArgs): Promise<number> {
  if (!args.model) throw new Error('--model is required');
  const artifact = getModelArtifact(args.model);
  const service = new NodeDownloadService();
  const modelPath = modelArtifactPath(artifact);
  const mmprojPath = mmprojArtifactPath(artifact);
  const modelUrl = resolveModelUrl(artifact);

  await downloadArtifactFile({
    service,
    label: `${artifact.id} model`,
    url: modelUrl,
    destinationPath: modelPath,
    ...(artifact.sizeBytes !== undefined ? { expectedBytes: artifact.sizeBytes } : {}),
    ...(args.force !== undefined ? { force: args.force } : {}),
  });

  if (artifact.requiresMmproj) {
    if (!artifact.mmprojUrl || !mmprojPath) {
      throw new Error(`Model "${artifact.id}" requires an mmproj artifact but none is configured.`);
    }
    await downloadArtifactFile({
      service,
      label: `${artifact.id} mmproj`,
      url: artifact.mmprojUrl,
      destinationPath: mmprojPath,
      ...(artifact.mmprojSizeBytes !== undefined ? { expectedBytes: artifact.mmprojSizeBytes } : {}),
      ...(args.force !== undefined ? { force: args.force } : {}),
    });
  }

  const kv = new NodeKVStorage(defaultSettingsPath);
  await kv.merge({
    lastModelId: artifact.id,
    downloadedModels: {
      [artifact.id]: {
        modelId: artifact.id,
        modelPath,
        ...(mmprojPath ? { mmprojPath } : {}),
        downloadedAt: Date.now(),
        modelUrl,
        ...(artifact.mmprojUrl ? { mmprojUrl: artifact.mmprojUrl } : {}),
      },
    },
  });

  console.log('');
  console.log('Download state saved.');
  console.log(await buildServerCommandFromSettings(artifact.id, args));
  return 0;
}

async function runDownloadEmbedding(args: ParsedArgs): Promise<number> {
  const service = new NodeDownloadService();
  const modelPath = embeddingArtifactPath();
  const modelUrl = resolveModelUrl(embeddingArtifact);

  await downloadArtifactFile({
    service,
    label: `${embeddingArtifact.id} model`,
    url: modelUrl,
    destinationPath: modelPath,
    ...(embeddingArtifact.sizeBytes !== undefined ? { expectedBytes: embeddingArtifact.sizeBytes } : {}),
    ...(args.force !== undefined ? { force: args.force } : {}),
  });

  const kv = new NodeKVStorage(defaultSettingsPath);
  await kv.merge({
    downloadedEmbeddingModel: {
      modelId: embeddingArtifact.id,
      modelPath,
      downloadedAt: Date.now(),
      modelUrl,
    },
  });

  console.log('');
  console.log('Embedding download state saved.');
  console.log(buildEmbeddingServerCommandFromDownloaded(modelPath, args));
  return 0;
}

async function runListModels(): Promise<number> {
  const settings = await new NodeKVStorage(defaultSettingsPath).read();
  for (const artifact of Object.values(modelArtifacts)) {
    const downloaded = settings.downloadedModels?.[artifact.id];
    console.log(`${artifact.id}`);
    console.log(`  label: ${artifact.label}`);
    console.log(`  vision: ${artifact.requiresMmproj ? 'yes, requires mmproj' : 'no/projector not required'}`);
    console.log(`  source: ${artifact.modelUrl ?? artifact.modelCdnPath ?? '(not configured)'}`);
    console.log(`  downloaded: ${downloaded ? 'yes' : 'no'}`);
    if (downloaded) {
      console.log(`  modelPath: ${downloaded.modelPath}`);
      if (downloaded.mmprojPath) console.log(`  mmprojPath: ${downloaded.mmprojPath}`);
    }
  }
  return 0;
}

async function buildServerCommandFromSettings(modelId: string, args: ParsedArgs): Promise<string> {
  const artifact = getModelArtifact(modelId);
  const settings = await new NodeKVStorage(defaultSettingsPath).read();
  const downloaded = resolveDownloadedModel(settings, modelId);
  await verifyDownloadedFiles(artifact, downloaded);
  const port = args.port ?? 8080;
  const contextSize = args.contextSize ?? artifact.contextSize;
  const binary = args.llamaServerBin ?? 'llama-server';
  const command = formatCommand(binary, buildLlamaServerArgs({ artifact, downloaded, port, contextSize }));
  return command;
}

function buildEmbeddingServerCommandFromDownloaded(modelPath: string, args: ParsedArgs): string {
  const port = args.embeddingPort ?? 8081;
  const contextSize = args.contextSize ?? embeddingArtifact.contextSize;
  const binary = args.llamaServerBin ?? 'llama-server';
  return formatCommand(binary, buildEmbeddingServerArgs({
    modelPath,
    port,
    contextSize,
    pooling: args.embeddingPooling ?? 'mean',
  }));
}

async function runPrintServerCommand(args: ParsedArgs): Promise<number> {
  if (!args.model) throw new Error('--model is required');
  console.log(await buildServerCommandFromSettings(args.model, args));
  return 0;
}

async function runChat(args: ParsedArgs): Promise<number> {
  if (!args.model) throw new Error('--model is required');
  if (!args.message) throw new Error('--message is required');
  if (!args.server && !args.autoServer) throw new Error('chat requires either --server <url> or --auto-server');
  if (args.server && args.autoServer) throw new Error('Use either --server or --auto-server, not both.');
  if (args.embeddingServer && args.autoEmbeddingServer) {
    throw new Error('Use either --embedding-server or --auto-embedding-server, not both.');
  }
  if (args.noEmbeddings && (args.embeddingServer || args.autoEmbeddingServer)) {
    throw new Error('Use either --no-embeddings or an embedding server option, not both.');
  }

  const kv = new NodeKVStorage(defaultSettingsPath);
  const settings = await kv.read();
  let managedChatServer: ManagedLlamaServerHandle | null = null;
  let managedEmbeddingServer: ManagedLlamaServerHandle | null = null;
  let serverUrl = args.server ?? '';
  let embeddingServerUrl = args.embeddingServer ?? '';
  let driver: NodeSQLiteDriver | null = null;

  try {
    if (args.autoServer) {
      const artifact = getModelArtifact(args.model);
      const downloaded = resolveDownloadedModel(settings, args.model);
      await verifyDownloadedFiles(artifact, downloaded);
      const port = args.port ?? await getFreePort();
      managedChatServer = await startManagedLlamaServer({
        llamaServerBin: args.llamaServerBin ?? 'llama-server',
        artifact,
        downloaded,
        port,
        contextSize: args.contextSize ?? artifact.contextSize,
      });
      serverUrl = managedChatServer.serverUrl;
    }

    if (args.autoEmbeddingServer) {
      const downloadedEmbedding = resolveDownloadedEmbedding(settings);
      await verifyDownloadedFiles(embeddingArtifact, downloadedEmbedding);
      const port = args.embeddingPort ?? await getFreePort();
      managedEmbeddingServer = await startManagedEmbeddingServer({
        llamaServerBin: args.llamaServerBin ?? 'llama-server',
        modelPath: downloadedEmbedding.modelPath,
        port,
        contextSize: embeddingArtifact.contextSize,
        pooling: args.embeddingPooling ?? 'mean',
      });
      embeddingServerUrl = managedEmbeddingServer.serverUrl;
    }

    await kv.merge({
      serverUrl,
      lastModelId: args.model,
    });

    const repositories = await createPersistentRepositories();
    driver = repositories.driver;
    const appSettingsRepository = new DesktopAppSettingsRepository(kv);
    const memoryService = new DesktopMemoryService(repositories.memoryRepository);

    if (!args.noEmbeddings && embeddingServerUrl) {
      const embeddingAdapter = new LlamaServerEmbeddingAdapter(embeddingServerUrl);
      await embeddingAdapter.initialize();
      memoryService.setEmbeddingService(embeddingAdapter);
    }

    const llmAdapter = new LlamaServerVisionAdapter(serverUrl);
    await llmAdapter.initialize();

    const result = await runPersistentChatTurn({
      chatRepository: repositories.chatRepository,
      memoryRepository: repositories.memoryRepository,
      appSettingsRepository,
      memoryService,
      llmAdapter,
      modelId: args.model,
      message: args.message,
      mode: args.mode ?? 'general',
      temperature: args.temperature ?? 0.7,
      maxTokens: args.maxTokens ?? 512,
      timeoutMs: args.timeoutMs ?? defaultProbeConfig.timeoutMs,
    });

    console.log(`Model: ${args.model} (${modelLabelFor(args.model)})`);
    console.log(`Server: ${serverUrl}`);
    if (managedChatServer) console.log(`Command: ${managedChatServer.command}`);
    if (embeddingServerUrl) {
      console.log(`Embeddings: ${embeddingServerUrl}`);
      if (managedEmbeddingServer) console.log(`Embedding command: ${managedEmbeddingServer.command}`);
    } else {
      console.log('Embeddings: score fallback');
    }
    console.log(`Context messages: ${result.contextMessageCount}`);
    console.log(`Relevant memories: ${result.relevantMemoryCount}`);
    console.log('');
    console.log(result.assistantMessage.content);
    return 0;
  } finally {
    driver?.close();
    if (managedEmbeddingServer && !args.keepServerAlive) {
      await managedEmbeddingServer.stop();
    } else if (managedEmbeddingServer && args.keepServerAlive) {
      console.log(`Keeping embedding llama-server alive at ${managedEmbeddingServer.serverUrl}`);
    }
    if (managedChatServer && !args.keepServerAlive) {
      await managedChatServer.stop();
    } else if (managedChatServer && args.keepServerAlive) {
      console.log(`Keeping llama-server alive at ${managedChatServer.serverUrl}`);
    }
  }
}

async function runMemoryReport(): Promise<number> {
  const kv = new NodeKVStorage(defaultSettingsPath);
  const settings = await kv.read();
  const { driver, chatRepository, memoryRepository } = await createPersistentRepositories();
  try {
    const [messageCount, summaryCount, memoryCount, memories] = await Promise.all([
      chatRepository.countMessages(persistentChatSessionId),
      memoryRepository.countSessionSummaries(persistentChatSessionId),
      memoryRepository.countSessionMemories(),
      memoryRepository.getAllSessionMemories(),
    ]);
    const embeddedCount = memories.filter((memory) => memory.embedding && memory.embedding.length > 0).length;
    console.log(`Persistent chat id: ${persistentChatSessionId}`);
    console.log(`Messages: ${messageCount}`);
    console.log(`Summary buckets: ${summaryCount}`);
    console.log(`Memory checkpoints: ${memoryCount}`);
    console.log(`Memories with embeddings: ${embeddedCount}`);
    console.log(`Pinned facts chars: ${settings.memorySettings?.pinnedFacts?.length ?? 0}`);
    console.log(`User profile chars: ${settings.memorySettings?.userProfile?.length ?? 0}`);
    return 0;
  } finally {
    driver.close();
  }
}

async function verifyDownloadedFiles(artifact: ModelArtifact, downloaded: DownloadedModelState): Promise<void> {
  if (!(await exists(downloaded.modelPath))) {
    throw new Error(`Downloaded model file is missing: ${downloaded.modelPath}. Run: npm run download-model -- --model ${artifact.id}`);
  }
  if (artifact.requiresMmproj) {
    if (!downloaded.mmprojPath) {
      throw new Error(`Downloaded mmproj path is missing for "${artifact.id}". Run: npm run download-model -- --model ${artifact.id}`);
    }
    if (!(await exists(downloaded.mmprojPath))) {
      throw new Error(`Downloaded mmproj file is missing: ${downloaded.mmprojPath}. Run: npm run download-model -- --model ${artifact.id}`);
    }
  }
}

function formatDate(timestamp: number | null): string {
  return timestamp ? new Date(timestamp).toISOString() : '(not completed)';
}

function printRunSummary(run: ProbeRun, results: ProbeResultRecord[], verdict: string, explanation: string): void {
  console.log(`Run: ${run.id}`);
  console.log(`Model: ${run.modelId} (${run.modelLabel})`);
  console.log(`Server: ${run.serverUrl}`);
  console.log(`Started: ${formatDate(run.startedAt)}`);
  console.log(`Completed: ${formatDate(run.completedAt)}`);
  console.log(`Status: ${run.status}`);
  console.log('');

  for (const testCase of testCases) {
    const image = results.find((result) => result.testId === testCase.id && result.withImage);
    const control = results.find((result) => result.testId === testCase.id && !result.withImage);
    const imageScore = image?.score ?? 'missing';
    const controlScore = control?.score ?? 'missing';
    console.log(`${testCase.id.padEnd(20)} image=${imageScore.toString().padEnd(14)} control=${controlScore}`);
  }

  console.log('');
  console.log(`Verdict: ${verdict}`);
  console.log(explanation);
}

async function runReport(): Promise<number> {
  const { driver, repository } = await createRepository();
  try {
    const report = await repository.getLatestRunReport();
    if (!report) {
      console.log('No probe runs found.');
      return 0;
    }
    printRunSummary(report.run, report.results, report.verdict, report.explanation);
    return 0;
  } finally {
    driver.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'help') {
    printHelp();
    return;
  }
  const code =
    args.command === 'probe'
      ? await runProbe(args)
      : args.command === 'download-model'
        ? await runDownloadModel(args)
        : args.command === 'download-embedding'
          ? await runDownloadEmbedding(args)
          : args.command === 'list-models'
            ? await runListModels()
            : args.command === 'print-server-command'
              ? await runPrintServerCommand(args)
              : args.command === 'chat'
                ? await runChat(args)
                : args.command === 'memory-report'
                  ? await runMemoryReport()
                  : await runReport();
  process.exitCode = code;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
