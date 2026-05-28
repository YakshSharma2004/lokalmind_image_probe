import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { imagePathToDataUrl, LlamaServerVisionAdapter } from './adapters/LlamaServerVisionAdapter.js';
import { buildLlamaServerArgs } from './adapters/ManagedLlamaServer.js';
import { NodeDownloadService } from './adapters/NodeDownloadService.js';
import { NodeSQLiteDriver } from './adapters/NodeSQLiteDriver.js';
import { validateChatArgs } from './cli.js';
import { resolveChatMaxTokens } from './config.js';
import type { DesktopAppSettingsRepository } from './data/DesktopAppSettingsRepository.js';
import type { DesktopMemoryRepository } from './data/DesktopMemoryRepository.js';
import type { PersistentChatRepository } from './data/PersistentChatRepository.js';
import { initializeSchema } from './data/schema.js';
import { VisionProbeRepository } from './data/VisionProbeRepository.js';
import { buildContextMessages } from './domain/appContext.js';
import { getModelArtifact, resolveModelUrl } from './domain/modelArtifacts.js';
import { buildDeterministicProfile, sanitizeUserProfile } from './domain/persistentMemoryMaintenance.js';
import { runPersistentChatTurn } from './domain/runPersistentChatTurn.js';
import { computeVisionVerdict, scoreVisionAnswer } from './domain/scoreVisionAnswer.js';
import { testCases } from './domain/testCases.js';
import { generateFixtures } from './fixtures/generateFixtures.js';
import type { PersistentChatMessage, ProbeMessage, SessionMemory, SessionSummary } from './types.js';

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'lokalmind-vision-probe-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function testFixtureGeneration(): Promise<void> {
  await withTempDir(async (dir) => {
    const paths = await generateFixtures(dir);
    assert.equal(paths.length, 4);
    for (const path of paths) {
      const bytes = await readFile(path);
      assert.ok(bytes.byteLength > 100, `${path} should be non-empty`);
    }
  });
}

async function testBase64EncodingAndRequestShape(): Promise<void> {
  await withTempDir(async (dir) => {
    const imagePath = join(dir, 'tiny.png');
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const dataUrl = await imagePathToDataUrl(imagePath);
    assert.ok(dataUrl.startsWith('data:image/png;base64,'));

    const adapter = new LlamaServerVisionAdapter('http://127.0.0.1:8080');
    const multimodal = await adapter.toOpenAIMessage({ role: 'user', content: 'Look', imagePath });
    assert.ok(Array.isArray(multimodal.content));
    assert.equal(multimodal.content[0]?.type, 'text');
    assert.equal(multimodal.content[1]?.type, 'image_url');

    const textOnly = await adapter.toOpenAIMessage({ role: 'user', content: 'No image' });
    assert.equal(typeof textOnly.content, 'string');
  });
}

async function testScoring(): Promise<void> {
  const shapes = testCases.find((testCase) => testCase.id === 'shapes-basic');
  assert.ok(shapes);
  assert.equal(scoreVisionAnswer(shapes, 'I see a red circle, blue square, and green triangle.').score, 'pass');
  assert.equal(scoreVisionAnswer(shapes, 'There is a red circle.').score, 'partial');
  assert.equal(scoreVisionAnswer(shapes, 'I cannot see any image.').score, 'fail');
  assert.equal(scoreVisionAnswer(shapes, null, 'HTTP 500').score, 'runtime_error');
  assert.equal(
    computeVisionVerdict([
      resultForVerdict('image-runtime', true, 'runtime_error'),
      resultForVerdict('control-fail', false, 'fail'),
    ]).verdict,
    'text_only_or_not_configured',
  );
  assert.equal(
    computeVisionVerdict([
      resultForVerdict('image-runtime', true, 'runtime_error'),
      resultForVerdict('control-runtime', false, 'runtime_error'),
    ]).verdict,
    'runtime_failed',
  );
}

function resultForVerdict(id: string, withImage: boolean, score: 'pass' | 'partial' | 'fail' | 'runtime_error') {
  return {
    id,
    runId: 'run-1',
    testId: 'shapes-basic',
    imagePath: 'shapes-basic.png',
    prompt: 'List shapes.',
    withImage,
    responseText: null,
    expectedSignals: '[]',
    forbiddenSignals: '[]',
    score,
    latencyMs: null,
    error: score === 'runtime_error' ? 'HTTP 400' : null,
    createdAt: Date.now(),
  };
}

async function testSQLiteRepository(): Promise<void> {
  await withTempDir(async (dir) => {
    const driver = new NodeSQLiteDriver(join(dir, 'vision-probe.db'));
    await driver.initialize();
    await initializeSchema(driver);
    const repo = new VisionProbeRepository(driver);
    const now = Date.now();
    await repo.createRun({
      id: 'run-1',
      modelId: 'test-model',
      modelLabel: 'Test Model',
      serverUrl: 'http://localhost:8080',
      serverCommand: null,
      startedAt: now,
      notes: null,
    });
    await repo.saveResult({
      id: 'result-1',
      runId: 'run-1',
      testId: 'shapes-basic',
      imagePath: 'shapes-basic.png',
      prompt: 'List shapes.',
      withImage: true,
      responseText: 'red circle and blue square',
      expectedSignals: '[]',
      forbiddenSignals: '[]',
      score: 'pass',
      latencyMs: 12,
      error: null,
      createdAt: now,
    });
    await repo.completeRun('run-1', 'completed', 'ok');
    const report = await repo.getLatestRunReport();
    assert.ok(report);
    assert.equal(report.run.id, 'run-1');
    assert.equal(report.results.length, 1);
    assert.equal(report.results[0]?.score, 'pass');
    driver.close();
  });
}

async function testAdapterFetchPayload(): Promise<void> {
  await withTempDir(async (dir) => {
    const imagePath = join(dir, 'tiny.png');
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const requests: unknown[] = [];
    const fetchMock: typeof fetch = async (_input, init) => {
      requests.push(init ? JSON.parse(String(init.body)) : null);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    };

    const adapter = new LlamaServerVisionAdapter('http://server.test', fetchMock);
    const response = await adapter.generateResponse(
      [{ role: 'user', content: 'Describe', imagePath }],
      { model: 'test', temperature: 0, maxTokens: 16, timeoutMs: 1000 },
    );
    assert.equal(response.text, 'ok');
    const body = requests[0] as {
      messages: Array<{ content: string | Array<{ type: string; image_url?: { url: string } }> }>;
    };
    assert.ok(Array.isArray(body.messages[0]?.content));
    const content = body.messages[0]?.content;
    assert.ok(Array.isArray(content));
    assert.equal(content[0]?.type, 'text');
    assert.equal(content[1]?.type, 'image_url');
    assert.ok(content[1]?.image_url?.url.startsWith('data:image/png;base64,'));
  });
}

async function testDownloadService(): Promise<void> {
  await withTempDir(async (dir) => {
    const destination = join(dir, 'model.gguf');
    const body = new Uint8Array([1, 2, 3, 4]);
    let fetchCalls = 0;
    const fetchMock: typeof fetch = async () => {
      fetchCalls += 1;
      return new Response(body, {
        status: 200,
        headers: { 'content-length': String(body.byteLength) },
      });
    };

    const service = new NodeDownloadService(fetchMock);
    const downloaded = await service.downloadFile('https://example.test/model.gguf', destination, {
      expectedBytes: body.byteLength,
    });
    assert.equal(downloaded.skipped, false);
    assert.equal((await readFile(destination)).byteLength, body.byteLength);
    assert.equal(await fileExists(`${destination}.partial`), false);

    const skipped = await service.downloadFile('https://example.test/model.gguf', destination, {
      expectedBytes: body.byteLength,
    });
    assert.equal(skipped.skipped, true);
    assert.equal(fetchCalls, 1);

    await assert.rejects(
      () => service.downloadFile('https://example.test/model.gguf', destination, { expectedBytes: body.byteLength + 1 }),
      /Existing file size mismatch/,
    );
  });
}

async function testDownloadFailureDeletesPartial(): Promise<void> {
  await withTempDir(async (dir) => {
    const destination = join(dir, 'bad.gguf');
    const service = new NodeDownloadService(async () => new Response(new Uint8Array([1, 2]), { status: 200 }));
    await assert.rejects(
      () => service.downloadFile('https://example.test/bad.gguf', destination, { expectedBytes: 99 }),
      /Downloaded size mismatch/,
    );
    assert.equal(await fileExists(`${destination}.partial`), false);
  });
}

async function testModelRegistryAndServerCommand(): Promise<void> {
  const artifact = getModelArtifact('gemma3-4b-vision');
  assert.equal(artifact.requiresMmproj, true);
  assert.ok(artifact.mmprojUrl);
  const modelUrl = resolveModelUrl(artifact);

  const appArtifact = getModelArtifact('qwen3.5-0.8b');
  assert.equal(appArtifact.requiresMmproj, false);
  assert.equal(appArtifact.modelCdnPath, 'models/qwen3.5-0.8b/Qwen_Qwen3.5-0.8B-Q4_K_M.gguf');
  const previousBaseUrl = process.env.VISION_PROBE_MODEL_BASE_URL;
  process.env.VISION_PROBE_MODEL_BASE_URL = 'https://cdn.example.test/';
  assert.equal(
    resolveModelUrl(appArtifact),
    'https://cdn.example.test/models/qwen3.5-0.8b/Qwen_Qwen3.5-0.8B-Q4_K_M.gguf',
  );
  if (previousBaseUrl === undefined) {
    delete process.env.VISION_PROBE_MODEL_BASE_URL;
  } else {
    process.env.VISION_PROBE_MODEL_BASE_URL = previousBaseUrl;
  }

  const args = buildLlamaServerArgs({
    artifact,
    downloaded: {
      modelId: artifact.id,
      modelPath: 'C:\\models\\gemma.gguf',
      mmprojPath: 'C:\\models\\mmproj.gguf',
      downloadedAt: Date.now(),
      modelUrl,
      mmprojUrl: artifact.mmprojUrl,
    },
    port: 8080,
    contextSize: 8192,
  });
  assert.deepEqual(args, [
    '-m',
    'C:\\models\\gemma.gguf',
    '-c',
    '8192',
    '--host',
    '127.0.0.1',
    '--port',
    '8080',
    '--mmproj',
    'C:\\models\\mmproj.gguf',
  ]);
}

async function testChatMaxTokensEnvDefault(): Promise<void> {
  const previous = process.env.CHAT_MAX_TOKENS;
  try {
    delete process.env.CHAT_MAX_TOKENS;
    assert.equal(resolveChatMaxTokens(), 512);
    process.env.CHAT_MAX_TOKENS = '2048';
    assert.equal(resolveChatMaxTokens(), 2048);
    process.env.CHAT_MAX_TOKENS = 'not-a-number';
    assert.equal(resolveChatMaxTokens(), 512);
    assert.equal(resolveChatMaxTokens(99), 99);
  } finally {
    if (previous === undefined) {
      delete process.env.CHAT_MAX_TOKENS;
    } else {
      process.env.CHAT_MAX_TOKENS = previous;
    }
  }
}

async function testContextBudgetKeepsNewestSummaries(): Promise<void> {
  const oldSummary: SessionSummary = {
    id: 'old',
    sessionId: 'persistent_chat',
    bucketIndex: 0,
    summary: `old summary ${'x'.repeat(560)}`,
    turnStart: 1,
    turnEnd: 10,
    createdAt: 1,
  };
  const newSummary: SessionSummary = {
    id: 'new',
    sessionId: 'persistent_chat',
    bucketIndex: 1,
    summary: `new summary ${'y'.repeat(560)}`,
    turnStart: 11,
    turnEnd: 20,
    createdAt: 2,
  };

  const messages = buildContextMessages({
    systemPrompt: 'System prompt.',
    pinnedFacts: '',
    userProfile: '',
    crossSessionMemories: [],
    inSessionSummaries: [oldSummary, newSummary],
    history: [],
    currentMessage: { role: 'user', content: 'Hello' },
  });

  const system = messages[0]?.content ?? '';
  assert.match(system, /new summary/);
  assert.doesNotMatch(system, /old summary/);
}

async function testChatDefaultsToNoMemoryContext(): Promise<void> {
  const saved: PersistentChatMessage[] = [];
  let capturedMessages: ProbeMessage[] = [];
  const chatRepository = {
    async getMessages() {
      throw new Error('history should not be read when memory is disabled');
    },
    async saveMessage(message: PersistentChatMessage) {
      saved.push(message);
    },
  } as unknown as PersistentChatRepository;
  const appSettingsRepository = throwingSettingsRepository();
  const memoryRepository = throwingMemoryRepository();
  const memoryService = {
    async getRelevantMemories() {
      throw new Error('memories should not be read when memory is disabled');
    },
  };
  const llmAdapter = {
    async generateResponse(messages: ProbeMessage[]) {
      capturedMessages = messages;
      return { text: 'ok', latencyMs: 1 };
    },
  } as unknown as LlamaServerVisionAdapter;

  const result = await runPersistentChatTurn({
    chatRepository,
    memoryRepository,
    appSettingsRepository,
    memoryService: memoryService as never,
    llmAdapter,
    modelId: 'test-model',
    message: 'Only use this turn.',
    mode: 'general',
    temperature: 0,
    maxTokens: 16,
    timeoutMs: 1000,
    memoryEnabled: false,
  });

  assert.equal(saved.length, 2);
  assert.equal(result.relevantMemoryCount, 0);
  assert.equal(result.summaryCount, 0);
  assert.equal(capturedMessages.length, 2);
  assert.equal(capturedMessages[0]?.role, 'system');
  assert.equal(capturedMessages[1]?.role, 'user');
  assert.equal(capturedMessages[1]?.content, 'Only use this turn.');
  assert.doesNotMatch(capturedMessages[0]?.content ?? '', /Human profile|Past conversations|Earlier in this conversation/);
}

async function testChatWithMemoryIncludesMemoryContext(): Promise<void> {
  const messages: PersistentChatMessage[] = [
    {
      id: 'history-1',
      sessionId: 'persistent_chat',
      role: 'user',
      content: 'Earlier detail?',
      status: 'done',
      createdAt: 1,
    },
  ];
  let capturedMessages: ProbeMessage[] = [];
  const chatRepository = {
    async getMessages() {
      return messages;
    },
    async saveMessage(message: PersistentChatMessage) {
      messages.push(message);
    },
  } as unknown as PersistentChatRepository;
  const appSettingsRepository = {
    async getModeSystemPromptOverride() {
      return null;
    },
    async getPinnedFacts() {
      return 'Pinned note.';
    },
    async getUserProfile() {
      return 'The person you are talking to is named Yaksh.';
    },
    async saveUserProfile() {
      throw new Error('profile should not be updated for question-only message');
    },
  } as unknown as DesktopAppSettingsRepository;
  const memoryRepository = {
    async getSessionSummaries() {
      return [
        {
          id: 'summary-1',
          sessionId: 'persistent_chat',
          bucketIndex: 0,
          summary: 'Earlier summary.',
          turnStart: 1,
          turnEnd: 2,
          createdAt: 1,
        },
      ] as SessionSummary[];
    },
  } as unknown as DesktopMemoryRepository;
  const memoryService = {
    async getRelevantMemories() {
      return [
        {
          id: 'memory-1',
          sessionId: 'persistent_chat',
          sessionTitle: 'Persistent Chat',
          summary: 'Remembered detail.',
          embedding: null,
          score: 1,
          isPinned: false,
          isUserEdited: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ] as SessionMemory[];
    },
  };
  const llmAdapter = {
    async generateResponse(messagesForLlm: ProbeMessage[]) {
      capturedMessages = messagesForLlm;
      return { text: 'ok', latencyMs: 1 };
    },
  } as unknown as LlamaServerVisionAdapter;

  const result = await runPersistentChatTurn({
    chatRepository,
    memoryRepository,
    appSettingsRepository,
    memoryService: memoryService as never,
    llmAdapter,
    modelId: 'test-model',
    message: 'What did I say before?',
    mode: 'general',
    temperature: 0,
    maxTokens: 16,
    timeoutMs: 1000,
    memoryEnabled: true,
  });

  const system = capturedMessages[0]?.content ?? '';
  assert.equal(result.relevantMemoryCount, 1);
  assert.equal(result.summaryCount, 1);
  assert.match(system, /Pinned note/);
  assert.match(system, /named Yaksh/);
  assert.match(system, /Remembered detail/);
  assert.match(system, /Earlier summary/);
  assert.ok(capturedMessages.some((message) => message.content === 'Earlier detail?'));
}

async function testCliRejectsEmbeddingFlagsWithoutMemory(): Promise<void> {
  assert.throws(
    () => validateChatArgs({
      command: 'chat',
      model: 'test-model',
      server: 'http://127.0.0.1:1',
      message: 'hello',
      noEmbeddings: true,
    }),
    /Memory is disabled by default/,
  );
}

async function testProfileSanitizer(): Promise<void> {
  const badProfile = [
    'The person you are talking to is named Yaksh.',
    'User-stated facts: User-stated facts: User-stated facts:',
    'My name is Yaksh and I am testing local model memory.',
    'My name is Yaksh and I am testing local model memory.',
    'my name is yaksh.',
  ].join(' ');
  assert.equal(sanitizeUserProfile(badProfile), 'The person you are talking to is named Yaksh.');
  assert.equal(
    buildDeterministicProfile(badProfile, ['my name is yaksh.']),
    'The person you are talking to is named Yaksh.',
  );
  assert.equal(
    sanitizeUserProfile(
      'The person you are talking to is named Yaksh. User-stated facts: I prefer concise answers. User-stated facts: I prefer concise answers.',
    ),
    'The person you are talking to is named Yaksh. User-stated facts: I prefer concise answers.',
  );
}

function throwingSettingsRepository(): DesktopAppSettingsRepository {
  return {
    async getModeSystemPromptOverride() {
      throw new Error('mode override should not be read when memory is disabled');
    },
    async getPinnedFacts() {
      throw new Error('pinned facts should not be read when memory is disabled');
    },
    async getUserProfile() {
      throw new Error('user profile should not be read when memory is disabled');
    },
  } as unknown as DesktopAppSettingsRepository;
}

function throwingMemoryRepository(): DesktopMemoryRepository {
  return {
    async getSessionSummaries() {
      throw new Error('summaries should not be read when memory is disabled');
    },
  } as unknown as DesktopMemoryRepository;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const tests: Array<[string, () => Promise<void>]> = [
  ['fixture generation', testFixtureGeneration],
  ['base64 encoding and request shape', testBase64EncodingAndRequestShape],
  ['scoring', testScoring],
  ['sqlite repository', testSQLiteRepository],
  ['adapter fetch payload', testAdapterFetchPayload],
  ['download service', testDownloadService],
  ['download failure cleanup', testDownloadFailureDeletesPartial],
  ['model registry and server command', testModelRegistryAndServerCommand],
  ['chat max tokens env default', testChatMaxTokensEnvDefault],
  ['context budget keeps newest summaries', testContextBudgetKeepsNewestSummaries],
  ['chat defaults to no memory context', testChatDefaultsToNoMemoryContext],
  ['chat with memory includes memory context', testChatWithMemoryIncludesMemoryContext],
  ['CLI rejects embedding flags without memory', testCliRejectsEmbeddingFlagsWithoutMemory],
  ['profile sanitizer', testProfileSanitizer],
];

for (const [name, test] of tests) {
  await test();
  console.log(`ok - ${name}`);
}
