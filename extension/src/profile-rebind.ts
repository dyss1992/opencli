import type { Command, Result } from './protocol';

const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9]{8}$/.test(value);

export function createProfileRebinder(dependencies: {
  ready(): Promise<void>;
  getContextId(): Promise<string>;
  isIdle(): boolean;
  storeContextId(contextId: string): Promise<void>;
  reload(): void;
  schedule(callback: () => void, delayMs: number): unknown;
}) {
  let pending: { id: string; stored: boolean; scheduled: boolean } | null = null;
  return {
    isPending: () => pending !== null,
    async prepare(command: Command): Promise<Result> {
      await dependencies.ready();
      if (pending || !dependencies.isIdle()) return { id: command.id, ok: false, errorCode: 'profile_rebind_busy', error: 'The extension is busy. Stop and inspect.' };
      const current = await dependencies.getContextId();
      if (!validId(command.expectedContextId) || !validId(command.rebindContextId) || command.contextId !== command.expectedContextId
        || current !== command.expectedContextId || current === command.rebindContextId) {
        return { id: command.id, ok: false, errorCode: 'profile_rebind_invalid', error: 'The expected profile ID does not match this extension.' };
      }
      // Claim before storage awaits; concurrent requests must not write a second identity.
      if (pending || !dependencies.isIdle()) return { id: command.id, ok: false, errorCode: 'profile_rebind_busy', error: 'The extension is busy. Stop and inspect.' };
      pending = { id: command.id, stored: false, scheduled: false };
      try {
        await dependencies.storeContextId(command.rebindContextId);
        pending.stored = true;
        return { id: command.id, ok: true, data: { contextId: command.rebindContextId, previousContextId: current } };
      } catch {
        return { id: command.id, ok: false, errorCode: 'profile_rebind_storage_failed', error: 'Profile storage could not be confirmed. Stop and inspect; do not retry.' };
      }
    },
    acknowledge(result: Result, sent: boolean): void {
      if (!sent || !result.ok || !pending?.stored || pending.id !== result.id || pending.scheduled) return;
      pending.scheduled = true;
      dependencies.schedule(() => dependencies.reload(), 250);
    },
  };
}
