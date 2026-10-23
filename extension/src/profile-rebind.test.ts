import { describe, expect, it, vi } from 'vitest';
import { createProfileRebinder } from './profile-rebind';
import type { Command } from './protocol';

const command: Command = { id: 'fixture-command', action: 'profile-rebind', contextId: 'new12345', expectedContextId: 'new12345', rebindContextId: 'old12345' };
function fixture() {
  const dependencies = {
    ready: vi.fn(async () => {}), getContextId: vi.fn(async () => 'new12345'), isIdle: vi.fn(() => true),
    storeContextId: vi.fn(async (_id: string) => {}), reload: vi.fn(), schedule: vi.fn((_callback: () => void, _delay: number) => {}),
  };
  return { dependencies, controller: createProfileRebinder(dependencies) };
}

describe('extension public profile ID rebind', () => {
  it('waits for recovery, writes only the requested ID, and reloads only after a sent ACK', async () => {
    const { dependencies, controller } = fixture();
    const result = await controller.prepare(command);
    expect(dependencies.ready).toHaveBeenCalledOnce();
    expect(dependencies.storeContextId).toHaveBeenCalledExactlyOnceWith('old12345');
    expect(result).toEqual({ id: command.id, ok: true, data: { contextId: 'old12345', previousContextId: 'new12345' } });
    expect(dependencies.schedule).not.toHaveBeenCalled();
    controller.acknowledge(result, false);
    expect(dependencies.schedule).not.toHaveBeenCalled();
    controller.acknowledge(result, true);
    expect(dependencies.schedule).toHaveBeenCalledWith(expect.any(Function), 250);
    expect(dependencies.reload).not.toHaveBeenCalled();
    dependencies.schedule.mock.calls[0][0]();
    expect(dependencies.reload).toHaveBeenCalledOnce();
    controller.acknowledge(result, true);
    expect(dependencies.schedule).toHaveBeenCalledOnce();
  });
  it.each([
    { expectedContextId: 'oth12345' }, { rebindContextId: 'default' }, { rebindContextId: 'new12345' }, { contextId: undefined },
  ])('rejects an invalid or mismatched command before storage: %s', async change => {
    const { dependencies, controller } = fixture();
    expect((await controller.prepare({ ...command, ...change })).ok).toBe(false);
    expect(dependencies.storeContextId).not.toHaveBeenCalled();
  });
  it('does not write while a page command is active', async () => {
    const { dependencies, controller } = fixture();
    dependencies.isIdle.mockReturnValue(false);
    expect(await controller.prepare(command)).toMatchObject({ errorCode: 'profile_rebind_busy' });
    expect(dependencies.storeContextId).not.toHaveBeenCalled();
  });
  it('serializes concurrent requests and leaves an uncertain storage result blocked', async () => {
    const { dependencies, controller } = fixture();
    dependencies.storeContextId.mockRejectedValue(new Error('fixture storage failed'));
    const results = await Promise.all([controller.prepare(command), controller.prepare({ ...command, id: 'second' })]);
    expect(results.every(result => result.ok === false)).toBe(true);
    expect(dependencies.storeContextId).toHaveBeenCalledOnce();
    expect(controller.isPending()).toBe(true);
    results.forEach(result => controller.acknowledge(result, true));
    expect(dependencies.schedule).not.toHaveBeenCalled();
  });
});
