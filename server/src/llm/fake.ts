import type { Availability, LlmProvider, LlmTask, ProviderId } from './types.js';

// Used by tests and by `--fake-llm` dev mode: never spends tokens.
export class FakeProvider implements LlmProvider {
  readonly calls: LlmTask[] = [];
  readonly readsFiles: boolean;
  loginOpened = 0;

  constructor(
    public availability: Availability = { ok: true },
    public respond: (task: LlmTask, signal: AbortSignal) => unknown = () => ({ greeting: 'Hello from the fake Claude!' }),
    readonly id: ProviderId = 'claude',
  ) {
    this.readsFiles = id === 'claude';
  }

  async checkAvailable(): Promise<Availability> {
    return this.availability;
  }

  async run<T>(task: LlmTask, signal: AbortSignal): Promise<T> {
    this.calls.push(task);
    return (await this.respond(task, signal)) as T;
  }

  openLogin(): void {
    this.loginOpened++;
  }
}
