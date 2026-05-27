import { randomUUID } from 'node:crypto';
import { persistentChatSessionId } from '../config.js';
import type { LlamaServerVisionAdapter } from '../adapters/LlamaServerVisionAdapter.js';
import type { DesktopAppSettingsRepository } from '../data/DesktopAppSettingsRepository.js';
import type { DesktopMemoryRepository } from '../data/DesktopMemoryRepository.js';
import type { PersistentChatRepository } from '../data/PersistentChatRepository.js';
import type { ChatMode, PersistentChatMessage } from '../types.js';
import { buildCappedLlmTurns, buildContextMessages, resolveSystemPromptForChat } from './appContext.js';
import type { DesktopMemoryService } from './DesktopMemoryService.js';
import { maybeRunMemoryMaintenance } from './persistentMemoryMaintenance.js';

export interface RunPersistentChatTurnParams {
  chatRepository: PersistentChatRepository;
  memoryRepository: DesktopMemoryRepository;
  appSettingsRepository: DesktopAppSettingsRepository;
  memoryService: DesktopMemoryService;
  llmAdapter: LlamaServerVisionAdapter;
  modelId: string;
  message: string;
  mode: ChatMode;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}

export interface PersistentChatTurnResult {
  userMessage: PersistentChatMessage;
  assistantMessage: PersistentChatMessage;
  contextMessageCount: number;
  relevantMemoryCount: number;
  summaryCount: number;
}

export async function runPersistentChatTurn(params: RunPersistentChatTurnParams): Promise<PersistentChatTurnResult> {
  const history = await params.chatRepository.getMessages(persistentChatSessionId);
  const now = Date.now();
  const userMessage: PersistentChatMessage = {
    id: `msg_${now}_${randomUUID()}_user`,
    sessionId: persistentChatSessionId,
    role: 'user',
    content: params.message,
    status: 'done',
    createdAt: now,
  };
  await params.chatRepository.saveMessage(userMessage);

  const { historyOnly, currentMessage } = buildCappedLlmTurns(history, userMessage);
  const modeOverride = await params.appSettingsRepository.getModeSystemPromptOverride(params.mode);
  const pinnedFacts = await params.appSettingsRepository.getPinnedFacts();
  const userProfile = await params.appSettingsRepository.getUserProfile();
  const summaries = await params.memoryRepository.getSessionSummaries(persistentChatSessionId);
  const memories = await params.memoryService.getRelevantMemories(userMessage.content, history.length);
  const systemPrompt = resolveSystemPromptForChat(params.mode, modeOverride);

  const llmMessages = buildContextMessages({
    systemPrompt,
    pinnedFacts,
    userProfile,
    crossSessionMemories: memories,
    inSessionSummaries: summaries,
    history: historyOnly,
    currentMessage,
  });

  let assistantText = '';
  let assistantStatus: PersistentChatMessage['status'] = 'done';
  try {
    const response = await params.llmAdapter.generateResponse(llmMessages, {
      model: params.modelId,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      timeoutMs: params.timeoutMs,
    });
    assistantText = response.text;
  } catch (error) {
    assistantStatus = 'error';
    assistantText = error instanceof Error ? error.message : String(error);
  }

  const assistantMessage: PersistentChatMessage = {
    id: `msg_${Date.now()}_${randomUUID()}_assistant`,
    sessionId: persistentChatSessionId,
    role: 'assistant',
    content: assistantStatus === 'done' ? assistantText : '',
    status: assistantStatus,
    createdAt: Date.now(),
  };
  await params.chatRepository.saveMessage(assistantMessage);

  if (assistantStatus === 'error') {
    throw new Error(assistantText || 'LLM generation failed');
  }

  await maybeRunMemoryMaintenance({
    chatRepository: params.chatRepository,
    memoryRepository: params.memoryRepository,
    memoryService: params.memoryService,
    appSettingsRepository: params.appSettingsRepository,
    llmAdapter: params.llmAdapter,
    modelId: params.modelId,
    timeoutMs: params.timeoutMs,
  });

  return {
    userMessage,
    assistantMessage,
    contextMessageCount: llmMessages.length,
    relevantMemoryCount: memories.length,
    summaryCount: summaries.length,
  };
}
