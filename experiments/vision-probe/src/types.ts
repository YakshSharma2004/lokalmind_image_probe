export type ProbeRole = 'system' | 'user' | 'assistant';
export type ChatMode = 'general' | 'coding' | 'creative' | 'marketing';

export interface ProbeMessage {
  role: ProbeRole;
  content: string;
  imagePath?: string;
}

export interface ProbeRequestConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}

export interface ProbeResponse {
  text: string;
  latencyMs: number;
}

export type ProbeScore = 'pass' | 'partial' | 'fail' | 'runtime_error';

export type ModelVisionVerdict =
  | 'vision_capable'
  | 'maybe_vision_capable'
  | 'text_only_or_not_configured'
  | 'runtime_failed';

export interface ExpectedSignal {
  label: string;
  patterns: string[];
}

export interface TestCase {
  id: string;
  imageFile: string;
  prompt: string;
  expectedSignals: ExpectedSignal[];
  forbiddenSignals: ExpectedSignal[];
  minSignalsForPass: number;
}

export interface ScoreResult {
  score: ProbeScore;
  matchedSignals: string[];
  forbiddenMatches: string[];
}

export interface ProbeRun {
  id: string;
  modelId: string;
  modelLabel: string;
  serverUrl: string;
  serverCommand: string | null;
  startedAt: number;
  completedAt: number | null;
  status: string;
  notes: string | null;
}

export interface ProbeResultRecord {
  id: string;
  runId: string;
  testId: string;
  imagePath: string;
  prompt: string;
  withImage: boolean;
  responseText: string | null;
  expectedSignals: string;
  forbiddenSignals: string;
  score: ProbeScore;
  latencyMs: number | null;
  error: string | null;
  createdAt: number;
}

export interface LatestRunReport {
  run: ProbeRun;
  results: ProbeResultRecord[];
  verdict: ModelVisionVerdict;
  explanation: string;
}

export interface VisionProbeSettings {
  serverUrl?: string;
  lastModelId?: string;
  lastFixtureDir?: string;
  llamaServerBin?: string;
  localModelPaths?: Record<string, string>;
  downloadedModels?: Record<string, DownloadedModelState>;
  downloadedEmbeddingModel?: DownloadedModelState;
  memorySettings?: MemorySettings;
}

export interface DownloadedModelState {
  modelId: string;
  modelPath: string;
  mmprojPath?: string;
  downloadedAt: number;
  modelUrl: string;
  mmprojUrl?: string;
}

export interface ModelArtifact {
  id: string;
  label: string;
  repoId?: string;
  modelUrl?: string;
  modelCdnPath?: string;
  filename: string;
  sizeBytes?: number;
  mmprojUrl?: string;
  mmprojFilename?: string;
  mmprojSizeBytes?: number;
  requiresMmproj: boolean;
  contextSize: number;
  notes: string;
}

export interface MemorySettings {
  pinnedFacts?: string;
  userProfile?: string;
  modeSystemPromptOverrides?: Partial<Record<ChatMode, string>>;
}

export type PersistentChatRole = 'user' | 'assistant';
export type PersistentChatStatus = 'done' | 'streaming' | 'error';

export interface PersistentChatMessage {
  id: string;
  sessionId: string;
  role: PersistentChatRole;
  content: string;
  status: PersistentChatStatus;
  createdAt: number;
}

export interface SessionSummary {
  id: string;
  sessionId: string;
  bucketIndex: number;
  summary: string;
  turnStart: number;
  turnEnd: number;
  createdAt: number;
}

export interface SessionMemory {
  id: string;
  sessionId: string;
  sessionTitle: string;
  summary: string;
  embedding: string | null;
  score: number;
  isPinned: boolean;
  isUserEdited: boolean;
  createdAt: number;
  updatedAt: number;
}
