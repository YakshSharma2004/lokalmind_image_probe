import { NodeKVStorage } from '../adapters/NodeKVStorage.js';
import type { ChatMode } from '../types.js';

const PINNED_FACTS_MAX_CHARS = 800;
const USER_PROFILE_MAX_CHARS = 600;
const allowedModes = new Set<ChatMode>(['general', 'coding', 'creative', 'marketing']);

export class DesktopAppSettingsRepository {
  constructor(private readonly storage: NodeKVStorage) {}

  async getModeSystemPromptOverride(mode: ChatMode): Promise<string | null> {
    if (!allowedModes.has(mode)) return null;
    const settings = await this.storage.read();
    return settings.memorySettings?.modeSystemPromptOverrides?.[mode] ?? null;
  }

  async saveModeSystemPromptOverride(mode: ChatMode, value: string): Promise<void> {
    if (!allowedModes.has(mode)) return;
    const settings = await this.storage.read();
    const overrides = { ...(settings.memorySettings?.modeSystemPromptOverrides ?? {}) };
    const trimmed = value.trim();
    if (trimmed) {
      overrides[mode] = trimmed;
    } else {
      delete overrides[mode];
    }
    await this.storage.merge({
      memorySettings: {
        ...(settings.memorySettings ?? {}),
        modeSystemPromptOverrides: overrides,
      },
    });
  }

  async getPinnedFacts(): Promise<string> {
    const settings = await this.storage.read();
    return settings.memorySettings?.pinnedFacts ?? '';
  }

  async savePinnedFacts(facts: string): Promise<void> {
    const settings = await this.storage.read();
    await this.storage.merge({
      memorySettings: {
        ...(settings.memorySettings ?? {}),
        pinnedFacts: facts.slice(0, PINNED_FACTS_MAX_CHARS),
      },
    });
  }

  async getUserProfile(): Promise<string> {
    const settings = await this.storage.read();
    return settings.memorySettings?.userProfile ?? '';
  }

  async saveUserProfile(profile: string): Promise<void> {
    const settings = await this.storage.read();
    await this.storage.merge({
      memorySettings: {
        ...(settings.memorySettings ?? {}),
        userProfile: profile.slice(0, USER_PROFILE_MAX_CHARS),
      },
    });
  }
}
