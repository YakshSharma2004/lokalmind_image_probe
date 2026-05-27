import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { imagePathToDataUrl, LlamaServerVisionAdapter } from './adapters/LlamaServerVisionAdapter.js';
import { buildLlamaServerArgs } from './adapters/ManagedLlamaServer.js';
import { NodeDownloadService } from './adapters/NodeDownloadService.js';
import { NodeSQLiteDriver } from './adapters/NodeSQLiteDriver.js';
import { initializeSchema } from './data/schema.js';
import { VisionProbeRepository } from './data/VisionProbeRepository.js';
import { getModelArtifact, resolveModelUrl } from './domain/modelArtifacts.js';
import { computeVisionVerdict, scoreVisionAnswer } from './domain/scoreVisionAnswer.js';
import { testCases } from './domain/testCases.js';
import { generateFixtures } from './fixtures/generateFixtures.js';

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
];

for (const [name, test] of tests) {
  await test();
  console.log(`ok - ${name}`);
}
