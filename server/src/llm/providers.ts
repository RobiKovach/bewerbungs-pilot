import type { ProviderId } from '@bp/shared';
import { AppError } from '../errors.js';
import type { LlmProvider } from './types.js';

/** All AI helpers the app knows, plus which one the person chose (read fresh on every call). */
export class ProviderRegistry {
  constructor(private readonly all: Record<ProviderId, LlmProvider>, private readonly chosen: () => ProviderId | null) {}

  get(id: ProviderId): LlmProvider {
    return this.all[id];
  }

  currentId(): ProviderId | null {
    return this.chosen();
  }

  /** Throws AppError('LLM_NOT_CHOSEN') when none is chosen — never falls back to a default. */
  current(): LlmProvider {
    const id = this.chosen();
    if (!id) throw new AppError('LLM_NOT_CHOSEN', 'no AI helper chosen');
    return this.all[id];
  }
}
