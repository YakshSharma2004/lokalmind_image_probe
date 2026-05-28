#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const settingsPath = resolve(packageRoot, '.data', 'settings.json');
const npmCommand = 'npm';
const rl = createInterface({ input, output });

let llamaServerBin = null;

async function main() {
  process.chdir(packageRoot);

  console.log('LokalMind Vision Probe Wizard');
  console.log(`Working directory: ${packageRoot}`);
  console.log('');

  const settings = await readSettings();
  llamaServerBin = await resolveLlamaServerBin(settings, true);
  if (llamaServerBin && settings.llamaServerBin !== llamaServerBin) {
    await mergeSettings({ llamaServerBin });
  }
  if (!llamaServerBin) {
    printLlamaServerMissing();
  }

  while (true) {
    await printMenu();
    const choice = await ask('Choose an option: ');
    console.log('');

    try {
      if (choice === '1') {
        await configureLlamaServerPath();
      } else if (choice === '2') {
        await runNpm(['run', 'list-models']);
      } else if (choice === '3') {
        await downloadModel();
      } else if (choice === '4') {
        await runNpm(['run', 'download-embedding']);
      } else if (choice === '5') {
        await chatWithModel();
      } else if (choice === '6') {
        await probeModel();
      } else if (choice === '7') {
        await runNpm(['run', 'memory-report']);
      } else if (choice === '8') {
        await runNpm(['run', 'report']);
      } else if (choice === '9' || choice.toLowerCase() === 'exit' || choice.toLowerCase() === 'q') {
        break;
      } else {
        console.log('Unknown option.');
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    }

    console.log('');
    await ask('Press Enter to continue...');
  }
}

async function printMenu() {
  const settings = await readSettings();
  const downloadedModels = await getDownloadedModels(settings);
  const embeddingState = await getEmbeddingState(settings);

  console.log('');
  console.log('LokalMind Vision Probe Wizard');
  console.log('');
  console.log(`llama-server: ${llamaServerBin ? `found at ${llamaServerBin}` : 'not found'}`);
  console.log('Downloaded models:');
  if (downloadedModels.length === 0) {
    console.log('- none');
  } else {
    for (const model of downloadedModels) {
      const suffix = model.valid ? '' : ` (${model.status})`;
      console.log(`- ${model.id}${suffix}`);
    }
  }
  console.log(`Embedding model: ${embeddingState}`);
  console.log('');
  console.log('1. Configure llama-server.exe path');
  console.log('2. List all registered models');
  console.log('3. Download a model');
  console.log('4. Download embedding model');
  console.log('5. Chat with a model (memory off by default)');
  console.log('6. Probe a model for image compatibility');
  console.log('7. Memory report');
  console.log('8. Latest probe report');
  console.log('9. Exit');
  console.log('');
}

async function configureLlamaServerPath() {
  const answer = await ask('Enter full path to llama-server.exe, or press Enter to auto-detect: ');
  const cleaned = cleanPath(answer);

  if (cleaned) {
    if (!isAbsolute(cleaned)) {
      console.log('Please provide a full absolute path to llama-server.exe.');
      return;
    }
    const normalized = await normalizeLlamaServerPath(cleaned);
    if (!normalized) {
      console.log(`File does not exist: ${cleaned}`);
      return;
    }
    llamaServerBin = normalized;
    await mergeSettings({ llamaServerBin });
    console.log(`Saved llama-server path: ${llamaServerBin}`);
    return;
  }

  const detected = await detectLlamaServerBin();
  if (!detected) {
    llamaServerBin = null;
    printLlamaServerMissing();
    return;
  }

  llamaServerBin = detected;
  await mergeSettings({ llamaServerBin });
  console.log(`Detected and saved llama-server path: ${llamaServerBin}`);
}

async function downloadModel() {
  console.log('Registered models:');
  await runNpm(['run', 'list-models']);
  console.log('');

  const modelId = await ask('Model id to download: ');
  if (!modelId) {
    console.log('No model selected.');
    return;
  }

  await runNpm(['run', 'download-model', '--', '--model', modelId]);
}

async function chatWithModel() {
  const selected = await selectDownloadedModel();
  if (!selected) return;
  if (!llamaServerBin) {
    printLlamaServerMissing();
    return;
  }

  const message = await ask('Message: ');
  if (!message) {
    console.log('No message entered.');
    return;
  }

  const useMemory = isYes(await ask('Use saved memory/profile/history? (y/N): '));
  let useEmbeddings = false;

  if (useMemory) {
    const settings = await readSettings();
    const hasEmbedding = await isEmbeddingReady(settings);
    if (hasEmbedding) {
      useEmbeddings = isYes(await ask('Use semantic embeddings for memory? (y/N): '));
    } else {
      console.log('Embedding model is missing. Memory will use score fallback.');
    }
  }

  const args = [
    'run',
    'chat',
    '--',
    '--model',
    selected.id,
    '--auto-server',
    '--llama-server-bin',
    llamaServerBin,
    '--message',
    message,
    '--debug',
  ];
  if (useMemory) {
    args.push('--with-memory');
    args.push(useEmbeddings ? '--auto-embedding-server' : '--no-embeddings');
  }

  const result = await runNpm(args);
  if (result.code !== 0 && isSpawnFailure(result)) {
    await printManualChatFallback(selected.id, message, useMemory, useEmbeddings);
  }
}

async function probeModel() {
  const selected = await selectDownloadedModel();
  if (!selected) return;
  if (!llamaServerBin) {
    printLlamaServerMissing();
    return;
  }

  const fixtureResult = await runNpm(['run', 'generate-fixtures']);
  if (fixtureResult.code !== 0) return;

  const result = await runNpm([
    'run',
    'probe',
    '--',
    '--model',
    selected.id,
    '--auto-server',
    '--llama-server-bin',
    llamaServerBin,
    '--debug',
  ]);

  if (result.code === 0) {
    await runNpm(['run', 'report']);
    return;
  }

  if (isSpawnFailure(result)) {
    await printManualProbeFallback(selected.id);
  }
}

async function selectDownloadedModel() {
  const settings = await readSettings();
  const downloadedModels = await getDownloadedModels(settings);
  const validModels = downloadedModels.filter((model) => model.valid);

  if (validModels.length === 0) {
    console.log('No downloaded model files are available. Use option 3 to download one first.');
    return null;
  }

  console.log('Downloaded models:');
  for (const model of validModels) {
    console.log(`- ${model.id}`);
  }

  const defaultModel = settings.lastModelId && validModels.some((model) => model.id === settings.lastModelId)
    ? settings.lastModelId
    : validModels[0].id;
  const answer = await ask(`Model id [${defaultModel}]: `);
  const id = answer || defaultModel;
  const selected = validModels.find((model) => model.id === id);

  if (!selected) {
    console.log(`Model is not downloaded or has missing files: ${id}`);
    return null;
  }

  return selected;
}

async function printManualChatFallback(modelId, message, useMemory, useEmbeddings) {
  console.log('');
  console.log('Auto server mode failed. Start llama-server manually, then run chat with --server.');
  console.log('');
  console.log('Terminal 1:');
  const command = await getModelServerCommand(modelId, 8080);
  if (command) console.log(command);

  if (useMemory && useEmbeddings) {
    const settings = await readSettings();
    const embeddingPath = settings.downloadedEmbeddingModel?.modelPath;
    if (embeddingPath) {
      console.log('');
      console.log('Terminal 2:');
      console.log(
        `${quotePowerShell(llamaServerBin)} -m ${quotePowerShell(embeddingPath)} --embedding --pooling mean -c 512 --host 127.0.0.1 --port 8081`,
      );
      console.log('');
      console.log('Terminal 3:');
      console.log(
        `npm run chat -- --model ${modelId} --server http://127.0.0.1:8080 --with-memory --embedding-server http://127.0.0.1:8081 --message ${quotePowerShell(message)}`,
      );
      return;
    }
  }

  console.log('');
  console.log('Terminal 2:');
  const memoryArgs = useMemory ? ' --with-memory --no-embeddings' : '';
  console.log(`npm run chat -- --model ${modelId} --server http://127.0.0.1:8080${memoryArgs} --message ${quotePowerShell(message)}`);
}

async function printManualProbeFallback(modelId) {
  console.log('');
  console.log('Auto server mode failed. Start llama-server manually, then run the probe.');
  console.log('');
  console.log('Terminal 1:');
  const command = await getModelServerCommand(modelId, 8080);
  if (command) console.log(command);
  console.log('');
  console.log('Terminal 2:');
  console.log(`npm run probe -- --model ${modelId} --server http://127.0.0.1:8080`);
  console.log('npm run report');
}

async function getModelServerCommand(modelId, port) {
  const result = await runNpm(
    ['run', 'print-server-command', '--', '--model', modelId, '--llama-server-bin', llamaServerBin, '--port', String(port)],
    { mirror: false },
  );
  if (result.code === 0) {
    return result.stdout.trim();
  }
  console.log(result.stderr.trim() || result.stdout.trim() || 'Failed to build server command.');
  return null;
}

async function resolveLlamaServerBin(settings, shouldAsk) {
  const saved = cleanPath(settings.llamaServerBin);
  if (saved) {
    const normalized = await normalizeLlamaServerPath(saved);
    if (normalized) return normalized;
    console.log(`Saved llama-server path is no longer valid: ${saved}`);
  }

  if (shouldAsk) {
    const answer = await ask('Enter full path to llama-server.exe, or press Enter to auto-detect: ');
    const provided = cleanPath(answer);
    if (provided) {
      const normalized = isAbsolute(provided) ? await normalizeLlamaServerPath(provided) : null;
      if (normalized) return normalized;
      console.log(`Could not use provided llama-server path: ${provided}`);
    }
  }

  return await detectLlamaServerBin();
}

async function detectLlamaServerBin() {
  const onPath = await findExecutableOnPath('llama-server');
  if (onPath) return onPath;

  const wingetPath = knownWingetLlamaServerPath();
  if (wingetPath && await isFile(wingetPath)) return wingetPath;

  return null;
}

async function findExecutableOnPath(name) {
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = await runCommand(command, [name], { mirror: false });
  if (result.code !== 0) return null;

  const firstLine = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine || null;
}

function knownWingetLlamaServerPath() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  return join(
    localAppData,
    'Microsoft',
    'WinGet',
    'Packages',
    'ggml.llamacpp_Microsoft.Winget.Source_8wekyb3d8bbwe',
    'llama-server.exe',
  );
}

async function getDownloadedModels(settings) {
  const entries = Object.entries(settings.downloadedModels ?? {});
  const models = [];

  for (const [id, downloaded] of entries) {
    const modelExists = downloaded?.modelPath ? await fileExists(downloaded.modelPath) : false;
    const mmprojExists = downloaded?.mmprojPath ? await fileExists(downloaded.mmprojPath) : true;
    let status = 'ready';
    if (!modelExists) status = 'missing model file';
    else if (!mmprojExists) status = 'missing mmproj file';
    models.push({
      id,
      valid: modelExists && mmprojExists,
      status,
    });
  }

  return models.sort((a, b) => a.id.localeCompare(b.id));
}

async function getEmbeddingState(settings) {
  if (!settings.downloadedEmbeddingModel?.modelPath) return 'missing';
  return await fileExists(settings.downloadedEmbeddingModel.modelPath) ? 'downloaded' : 'missing file';
}

async function isEmbeddingReady(settings) {
  return await getEmbeddingState(settings) === 'downloaded';
}

async function readSettings() {
  try {
    const raw = await readFile(settingsPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    if (error && error.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeSettings(settings) {
  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

async function mergeSettings(partial) {
  const current = await readSettings();
  await writeSettings({
    ...current,
    ...partial,
  });
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function normalizeLlamaServerPath(candidate) {
  try {
    const info = await stat(candidate);
    if (info.isFile()) return candidate;
    if (info.isDirectory()) {
      const nested = join(candidate, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
      return await isFile(nested) ? nested : null;
    }
    return null;
  } catch {
    return null;
  }
}

async function runNpm(args, options = {}) {
  return await runCommand(npmCommand, args, {
    mirror: options.mirror !== false,
    shell: process.platform === 'win32',
  });
}

async function runCommand(command, args, options = {}) {
  const mirror = options.mirror !== false;

  return await new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: packageRoot,
        stdio: ['inherit', 'pipe', 'pipe'],
        windowsHide: true,
        shell: options.shell === true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (mirror) console.error(message);
      resolve({ code: 1, stdout: '', stderr: message, error });
      return;
    }

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stdout += text;
      if (mirror) process.stdout.write(text);
    });
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderr += text;
      if (mirror) process.stderr.write(text);
    });
    child.on('error', (error) => {
      const message = error instanceof Error ? error.message : String(error);
      stderr += message;
      if (mirror) console.error(message);
      resolve({ code: 1, stdout, stderr, error });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function isSpawnFailure(result) {
  const text = `${result.stdout}\n${result.stderr}`;
  return text.includes('EPERM') ||
    text.includes('EINVAL') ||
    text.includes('ENOENT') ||
    text.includes('not allowed to spawn') ||
    text.includes('not found on PATH');
}

function printLlamaServerMissing() {
  console.log('llama-server was not found.');
  console.log('Install it with:');
  console.log('winget install --id ggml.llamacpp --exact');
  console.log('Or use menu option 1 to provide the full path to llama-server.exe.');
}

function cleanPath(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/^["']|["']$/g, '');
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function isYes(value) {
  const normalized = value.trim().toLowerCase();
  return normalized === 'y' || normalized === 'yes';
}

async function ask(prompt) {
  return (await rl.question(prompt)).trim();
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    rl.close();
  });
