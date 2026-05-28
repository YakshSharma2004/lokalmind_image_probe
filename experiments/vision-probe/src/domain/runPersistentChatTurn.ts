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
  memoryEnabled: boolean;
  debugLog?: ((message: string) => void) | undefined;
}

export interface PersistentChatTurnResult {
  userMessage: PersistentChatMessage;
  assistantMessage: PersistentChatMessage;
  contextMessageCount: number;
  relevantMemoryCount: number;
  summaryCount: number;
  responseLatencyMs: number | null;
  assistantTextLength: number;
  assistantTextTrimmedLength: number;
}

export async function runPersistentChatTurn(params: RunPersistentChatTurnParams): Promise<PersistentChatTurnResult> {
  const history = params.memoryEnabled
    ? await params.chatRepository.getMessages(persistentChatSessionId)
    : [];
  params.debugLog?.(
    params.memoryEnabled
      ? `[chat] loaded history messages=${history.length}`
      : '[chat] memory disabled; skipping history/profile/memory context',
  );
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
  params.debugLog?.(`[chat] saved user message id=${userMessage.id} chars=${userMessage.content.length}`);

  const { historyOnly, currentMessage } = buildCappedLlmTurns(history, userMessage);
  const modeOverride = params.memoryEnabled
    ? await params.appSettingsRepository.getModeSystemPromptOverride(params.mode)
    : null;
  const pinnedFacts = params.memoryEnabled ? await params.appSettingsRepository.getPinnedFacts() : '';
  const userProfile = params.memoryEnabled ? await params.appSettingsRepository.getUserProfile() : '';
  const summaries = params.memoryEnabled
    ? await params.memoryRepository.getSessionSummaries(persistentChatSessionId)
    : [];
  const memories = params.memoryEnabled
    ? await params.memoryService.getRelevantMemories(userMessage.content, history.length)
    : [];
  const systemPrompt = resolveSystemPromptForChat(params.mode, modeOverride);
  params.debugLog?.(
    `[chat] context inputs mode=${params.mode} history_included=${historyOnly.length} ` +
    `summaries=${summaries.length} relevant_memories=${memories.length} ` +
    `pinned_chars=${pinnedFacts.length} profile_chars=${userProfile.length}`,
  );

  const llmMessages = buildContextMessages({
    systemPrompt,
    pinnedFacts,
    userProfile,
    crossSessionMemories: memories,
    inSessionSummaries: summaries,
    history: historyOnly,
    currentMessage,
  });
  params.debugLog?.(`[chat] built context messages=${llmMessages.length}`);
  llmMessages.forEach((message, index) => {
    params.debugLog?.(
      `[chat] context ${index + 1}: role=${message.role} chars=${message.content.length} ` +
      `preview="${preview(message.content, 260)}"`,
    );
  });

  let assistantText = '';
  let assistantStatus: PersistentChatMessage['status'] = 'done';
  let responseLatencyMs: number | null = null;
  try {
    params.debugLog?.(
      `[chat] sending generation request model=${params.modelId} ` +
      `temperature=${params.temperature} max_tokens=${params.maxTokens} timeout_ms=${params.timeoutMs}`,
    );
    const response = await params.llmAdapter.generateResponse(llmMessages, {
      model: params.modelId,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      timeoutMs: params.timeoutMs,
    });
    assistantText = response.text;
    responseLatencyMs = response.latencyMs;
    params.debugLog?.(
      `[chat] generation completed latency_ms=${response.latencyMs} ` +
      `text_chars=${assistantText.length} trimmed_chars=${assistantText.trim().length} ` +
      `preview="${preview(assistantText, 500)}"`,
    );
    if (assistantText.trim().length === 0) {
      params.debugLog?.('[chat] WARNING: final assistant text is empty or whitespace-only.');
    }
  } catch (error) {
    assistantStatus = 'error';
    assistantText = error instanceof Error ? error.message : String(error);
    params.debugLog?.(`[chat] generation error: ${assistantText}`);
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
  params.debugLog?.(
    `[chat] saved assistant message id=${assistantMessage.id} status=${assistantMessage.status} ` +
    `chars=${assistantMessage.content.length}`,
  );

  if (assistantStatus === 'error') {
    throw new Error(assistantText || 'LLM generation failed');
  }

  if (params.memoryEnabled) {
    params.debugLog?.('[chat] running memory maintenance if needed');
    await maybeRunMemoryMaintenance({
      chatRepository: params.chatRepository,
      memoryRepository: params.memoryRepository,
      memoryService: params.memoryService,
      appSettingsRepository: params.appSettingsRepository,
      llmAdapter: params.llmAdapter,
      modelId: params.modelId,
      timeoutMs: params.timeoutMs,
    });
    params.debugLog?.('[chat] memory maintenance completed');
  } else {
    params.debugLog?.('[chat] memory maintenance skipped');
  }

  return {
    userMessage,
    assistantMessage,
    contextMessageCount: llmMessages.length,
    relevantMemoryCount: memories.length,
    summaryCount: summaries.length,
    responseLatencyMs,
    assistantTextLength: assistantText.length,
    assistantTextTrimmedLength: assistantText.trim().length,
  };
}

function preview(value: string, maxLength: number): string {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength)}...`;
}
