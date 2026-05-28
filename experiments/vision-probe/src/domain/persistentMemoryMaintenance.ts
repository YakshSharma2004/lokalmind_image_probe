import { persistentChatSessionId, persistentChatTitle } from '../config.js';
import type { LlamaServerVisionAdapter } from '../adapters/LlamaServerVisionAdapter.js';
import type { PersistentChatRepository } from '../data/PersistentChatRepository.js';
import type { DesktopAppSettingsRepository } from '../data/DesktopAppSettingsRepository.js';
import type { DesktopMemoryRepository } from '../data/DesktopMemoryRepository.js';
import type { DesktopMemoryService } from './DesktopMemoryService.js';
import type { PersistentChatMessage, SessionMemory, SessionSummary } from '../types.js';

interface ParsedSummary {
  topics: string;
  facts: string;
  done: string;
  open: string;
}

const PROFILE_MAX_CHARS = 600;
const SUMMARY_BUCKET_SIZE = 10;
const USER_FACTS_LABEL_REGEX = /\bUser-stated facts:\s*/gi;
const DURABLE_PROFILE_FACT_REGEX =
  /\b(i prefer|i like|i use|i work as|i live in|i am a|i am an|i'm a|i'm an|my role|my job|my preference|my preferences|my company|my location)\b/i;
const TEMPORARY_PROFILE_FACT_REGEX =
  /\b(testing|trying|debugging|running|working on|for now|currently|local model memory)\b/i;

const summarizePrompt = (conversation: string) => `Read this conversation and fill in these fields. Write each field on its own line. No extra text.

TOPICS: list of topics, max 5, comma separated
FACTS: facts about the user - name, job, preferences, decisions
DONE: conclusions or action items the user reached
OPEN: unresolved questions or tasks (write NONE if nothing)

Conversation:
${conversation.slice(0, 3000)}`;

const profileUpdatePrompt = (profile: string, conversation: string) =>
  `You are a memory assistant. Extract facts about the human user from their messages.

Current profile:
${profile || '(none yet)'}

User messages:
${conversation}

Output a single plain paragraph. Start with their name if known. Example: "The person you are talking to is named Alex."

Rules:
- ONLY use facts the user EXPLICITLY STATED word-for-word. Never infer, guess, or add any detail not directly said by the user.
- Always start with "The person you are talking to is named [name]." if the name is known.
- IGNORE questions.
- IGNORE small talk.
- Keep existing facts unless the user corrects them.
- If nothing new was learned, return the current profile unchanged.
- Max 400 characters. No headers, no lists, no quotes.`;

export async function maybeRunMemoryMaintenance(params: {
  chatRepository: PersistentChatRepository;
  memoryRepository: DesktopMemoryRepository;
  memoryService: DesktopMemoryService;
  appSettingsRepository: DesktopAppSettingsRepository;
  llmAdapter: LlamaServerVisionAdapter;
  modelId: string;
  timeoutMs: number;
}): Promise<void> {
  const messages = await params.chatRepository.getMessages(persistentChatSessionId);
  await maybeUpdateUserProfile({
    appSettingsRepository: params.appSettingsRepository,
    llmAdapter: params.llmAdapter,
    modelId: params.modelId,
    messages,
    timeoutMs: params.timeoutMs,
  });

  const count = messages.length;
  if (count === 0 || count % SUMMARY_BUCKET_SIZE !== 0) return;

  const bucketIndex = Math.floor(count / SUMMARY_BUCKET_SIZE) - 1;
  const existingSummary = await params.memoryRepository.getSessionSummaryByBucket(persistentChatSessionId, bucketIndex);
  const memoryId = `mem_${persistentChatSessionId}_checkpoint_${bucketIndex}`;
  const existingMemory = await params.memoryRepository.getSessionMemoryById(memoryId);
  if (existingSummary && existingMemory) return;

  const turnStart = bucketIndex * SUMMARY_BUCKET_SIZE + 1;
  const turnEnd = bucketIndex * SUMMARY_BUCKET_SIZE + SUMMARY_BUCKET_SIZE;
  const bucketMessages = await params.chatRepository.getMessageRange(
    persistentChatSessionId,
    turnStart - 1,
    SUMMARY_BUCKET_SIZE,
  );

  if (!existingSummary) {
    const summaryText = await createLlmSummary({
      llmAdapter: params.llmAdapter,
      modelId: params.modelId,
      messages: bucketMessages,
      timeoutMs: params.timeoutMs,
    });
    if (summaryText) {
      const summary: SessionSummary = {
        id: `sum_${persistentChatSessionId}_${bucketIndex}`,
        sessionId: persistentChatSessionId,
        bucketIndex,
        summary: summaryText,
        turnStart,
        turnEnd,
        createdAt: Date.now(),
      };
      await params.memoryRepository.saveSessionSummary(summary);
    }
  }

  if (!existingMemory) {
    const deterministic = buildDeterministicCrossSessionSummary(
      persistentChatTitle,
      Date.now(),
      bucketMessages,
    );
    if (!deterministic) return;

    const now = Date.now();
    const memory: SessionMemory = {
      id: memoryId,
      sessionId: persistentChatSessionId,
      sessionTitle: persistentChatTitle,
      summary: deterministic.summary,
      embedding: null,
      score: computeScore(now, bucketMessages.length),
      isPinned: false,
      isUserEdited: false,
      createdAt: now,
      updatedAt: now,
    };
    await params.memoryRepository.saveSessionMemory(memory);
    await params.memoryService.embedAndSave(memory.id, memory.summary);
    await params.memoryService.evictIfNeeded();
  }
}

async function createLlmSummary(params: {
  llmAdapter: LlamaServerVisionAdapter;
  modelId: string;
  messages: PersistentChatMessage[];
  timeoutMs: number;
}): Promise<string | null> {
  const conversation = params.messages
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content.slice(0, 500)}`)
    .join('\n');
  const response = await params.llmAdapter.generateResponse(
    [{ role: 'user', content: summarizePrompt(conversation || `Session: ${persistentChatTitle}`) }],
    { model: params.modelId, temperature: 0.3, maxTokens: 80, timeoutMs: params.timeoutMs },
  );
  const parsed = parseSummaryResponse(response.text);
  const allNone = parsed.topics === 'NONE' && parsed.facts === 'NONE' && parsed.done === 'NONE' && parsed.open === 'NONE';
  return allNone ? null : formatSummary(parsed, persistentChatTitle, Date.now());
}

async function maybeUpdateUserProfile(params: {
  appSettingsRepository: DesktopAppSettingsRepository;
  llmAdapter: LlamaServerVisionAdapter;
  modelId: string;
  messages: PersistentChatMessage[];
  timeoutMs: number;
}): Promise<void> {
  const userMessages = params.messages
    .slice(-20)
    .filter((message) => message.role === 'user')
    .map((message) => message.content.trim());
  if (!userMessages.some((content) => hasMeaningfulProfileStatement(content))) return;

  const rawCurrentProfile = await params.appSettingsRepository.getUserProfile();
  const currentProfile = sanitizeUserProfile(rawCurrentProfile);
  const deterministicProfile = buildDeterministicProfile(currentProfile, userMessages);
  if (deterministicProfile && deterministicProfile !== currentProfile) {
    await params.appSettingsRepository.saveUserProfile(deterministicProfile);
    return;
  }
  if (currentProfile !== rawCurrentProfile) {
    await params.appSettingsRepository.saveUserProfile(currentProfile);
    return;
  }

  const conversation = userMessages.map((content) => content.slice(0, 300)).join('\n');
  const response = await params.llmAdapter.generateResponse(
    [{ role: 'user', content: profileUpdatePrompt(currentProfile, conversation) }],
    { model: params.modelId, temperature: 0.2, maxTokens: 150, timeoutMs: params.timeoutMs },
  );
  const updated = sanitizeUserProfile(response.text).slice(0, PROFILE_MAX_CHARS);
  if (!updated || updated === currentProfile) return;
  if (currentProfile && updated.length < currentProfile.length * 0.8) return;
  await params.appSettingsRepository.saveUserProfile(updated);
}

function parseSummaryResponse(raw: string): ParsedSummary {
  const result: ParsedSummary = { topics: 'NONE', facts: 'NONE', done: 'NONE', open: 'NONE' };
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith('topics:') || lower.startsWith('topic:')) {
      result.topics = line.split(':').slice(1).join(':').trim() || 'NONE';
    } else if (lower.startsWith('facts:') || lower.startsWith('fact:') || lower.startsWith('user_facts:')) {
      result.facts = line.split(':').slice(1).join(':').trim() || 'NONE';
    } else if (lower.startsWith('done:') || lower.startsWith('decisions:') || lower.startsWith('decision:')) {
      result.done = line.split(':').slice(1).join(':').trim() || 'NONE';
    } else if (lower.startsWith('open:')) {
      result.open = line.split(':').slice(1).join(':').trim() || 'NONE';
    }
  }
  return result;
}

function computeScore(createdAt: number, turnCount: number): number {
  const daysAgo = (Date.now() - createdAt) / 86_400_000;
  const recency = 1 / (1 + daysAgo);
  const engagement = Math.min(turnCount / 50, 1);
  return 0.7 * recency + 0.3 * engagement;
}

function formatDaysAgo(createdAt: number): string {
  const days = Math.floor((Date.now() - createdAt) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return weeks === 1 ? '1w ago' : `${weeks}w ago`;
}

function formatSummary(parsed: ParsedSummary, sessionTitle: string, createdAt: number): string {
  return `[${formatDaysAgo(createdAt)} - ${sessionTitle}]
Topics: ${parsed.topics}
User facts: ${parsed.facts}
Resolved: ${parsed.done}
Open: ${parsed.open}`;
}

function buildDeterministicCrossSessionSummary(
  sessionTitle: string,
  createdAt: number,
  messages: PersistentChatMessage[],
): { summary: string; userStatementCount: number } | null {
  const seen = new Set<string>();
  const userStatements: string[] = [];

  for (const message of messages) {
    if (message.role !== 'user') continue;
    const normalized = normalizeText(message.content);
    if (!isMeaningfulUserStatement(normalized)) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    userStatements.push(normalized.slice(0, 220));
  }

  if (userStatements.length === 0) return null;
  const selected = userStatements.slice(-8);
  return {
    summary: `[${formatDaysAgo(createdAt)} - ${sessionTitle}]
User-stated facts:
${selected.map((line) => `- ${line}`).join('\n')}`,
    userStatementCount: selected.length,
  };
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function isMeaningfulUserStatement(text: string): boolean {
  if (text.length < 10) return false;
  if (text.endsWith('?') && !text.includes('.') && !text.includes('!')) return false;
  return true;
}

function hasMeaningfulProfileStatement(content: string): boolean {
  if (content.length < 8) return false;
  if (content.endsWith('?') && !content.includes('.') && !content.includes('!')) return false;
  return true;
}

const NAME_FROM_MY_NAME_IS = /\bmy name is\s+([a-z][a-z'-]{1,30}(?:\s+[a-z][a-z'-]{1,30}){0,1})\b/i;
const NAME_FROM_I_AM_STRICT = /^\s*i am\s+([a-z][a-z'-]{1,30}(?:\s+[a-z][a-z'-]{1,30}){0,1})\s*[.!]?\s*$/i;
const NAME_FROM_IM_STRICT = /^\s*i'm\s+([a-z][a-z'-]{1,30}(?:\s+[a-z][a-z'-]{1,30}){0,1})\s*[.!]?\s*$/i;

export function buildDeterministicProfile(currentProfile: string, userMessages: string[]): string | null {
  const sanitizedCurrentProfile = sanitizeUserProfile(currentProfile);
  const existingName = extractCurrentProfileName(sanitizedCurrentProfile);
  let name: string | null = existingName;
  const factSet = new Map<string, string>();

  for (const fact of extractProfileFacts(sanitizedCurrentProfile)) {
    addProfileFact(factSet, fact);
  }

  for (const raw of userMessages) {
    const text = normalizeText(raw);
    if (!text || isSmallTalk(text) || isQuestionOnly(text) || startsLikeQuestion(text)) continue;
    const maybeName = extractNameFromText(text);
    if (maybeName) name = maybeName;
    extractDurableProfileFacts(text).forEach((fact) => addProfileFact(factSet, fact));
  }

  if (!name && factSet.size === 0) return null;
  const pieces: string[] = [];
  if (name) pieces.push(`The person you are talking to is named ${name}.`);
  const facts = Array.from(factSet.values()).slice(0, 6);
  if (facts.length > 0) pieces.push(`User-stated facts: ${facts.join(' ')}`);
  return sanitizeUserProfile(pieces.join(' ')).slice(0, PROFILE_MAX_CHARS);
}

export function sanitizeUserProfile(profile: string): string {
  const cleaned = normalizeText(profile.replace(USER_FACTS_LABEL_REGEX, ''));
  if (!cleaned) return '';

  const name = extractCurrentProfileName(cleaned) ?? extractNameFromText(cleaned);
  const factSet = new Map<string, string>();
  for (const fact of extractProfileFacts(cleaned)) {
    addProfileFact(factSet, fact);
  }

  const pieces: string[] = [];
  if (name) pieces.push(`The person you are talking to is named ${name}.`);
  const facts = Array.from(factSet.values()).slice(0, 6);
  if (facts.length > 0) pieces.push(`User-stated facts: ${facts.join(' ')}`);
  return normalizeText(pieces.join(' ')).slice(0, PROFILE_MAX_CHARS);
}

function extractDurableProfileFacts(text: string): string[] {
  return text
    .split(/[.!\n]/)
    .map((value) => normalizeText(value))
    .filter((value) => value.length >= 10)
    .filter((value) => !value.endsWith('?'))
    .filter((value) => !startsLikeQuestion(value))
    .filter((value) => !extractNameFromText(value))
    .filter(isDurableProfileFact)
    .slice(0, 2);
}

function addProfileFact(factSet: Map<string, string>, fact: string): void {
  const normalized = normalizeText(fact.replace(USER_FACTS_LABEL_REGEX, ''));
  if (!isDurableProfileFact(normalized)) return;
  const withPeriod = normalized.endsWith('.') ? normalized : `${normalized}.`;
  const key = withPeriod.toLowerCase();
  if (!factSet.has(key)) factSet.set(key, withPeriod);
}

function isDurableProfileFact(value: string): boolean {
  const text = normalizeText(value.replace(USER_FACTS_LABEL_REGEX, ''));
  if (text.length < 10) return false;
  if (extractNameFromText(text)) return false;
  if (TEMPORARY_PROFILE_FACT_REGEX.test(text)) return false;
  return DURABLE_PROFILE_FACT_REGEX.test(text);
}

function isQuestionOnly(text: string): boolean {
  return text.endsWith('?') && !text.includes('.') && !text.includes('!');
}

function startsLikeQuestion(text: string): boolean {
  return /^(who|what|where|when|why|how|which|can|could|would|should|do|did|does|is|are|am|will)\b/i.test(text.trim());
}

function isSmallTalk(text: string): boolean {
  const value = text.toLowerCase();
  return value === 'hi' || value === 'hey' || value === 'hello' || value === 'yo' || value === 'sup';
}

function extractNameFromText(text: string): string | null {
  const source =
    text.match(NAME_FROM_MY_NAME_IS)?.[1] ??
    text.match(NAME_FROM_I_AM_STRICT)?.[1] ??
    text.match(NAME_FROM_IM_STRICT)?.[1];
  if (!source || !isLikelyNameCandidate(source)) return null;
  return source.trim().split(/\s+/).slice(0, 2).join(' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function isLikelyNameCandidate(value: string): boolean {
  const words = value.trim().split(/\s+/);
  if (words.length === 0 || words.length > 2) return false;
  return words.every((word) => /^[a-z][a-z'-]{1,30}$/i.test(word));
}

function extractCurrentProfileName(profile: string): string | null {
  const match = profile.match(
    /^The person you are talking to is named\s+([A-Za-z][A-Za-z'-]{1,30}(?:\s+[A-Za-z][A-Za-z'-]{1,30}){0,2})\./i,
  );
  return match?.[1]?.trim() ?? null;
}

function extractProfileFacts(profile: string): string[] {
  return profile
    .replace(USER_FACTS_LABEL_REGEX, '')
    .split(/[.]\s+/)
    .map((value) => normalizeText(value))
    .filter((value) => value.length > 0)
    .filter((value) => !/^the person you are talking to is named\b/i.test(value));
}
