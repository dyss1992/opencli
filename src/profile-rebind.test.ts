import { describe, expect, it, vi } from 'vitest';
import { batchProfileRebind, isRebindContextId, parseRebindStatus, planProfileRebind, validateProfileRebind, watchProfileRebind, type ProfileRebindTransport } from './profile-rebind.js';

const original = 'old12345';
const fresh = 'new12345';
const other = 'oth12345';
const request = { contextId: fresh, expectedContextId: fresh, rebindContextId: original };
const status = (...ids: string[]) => ({ ok: true as const, pending: 0, profiles: ids.map(contextId => ({ contextId })) });

function transport(sequence: unknown[], submit = vi.fn(async (command: { id: string }) => ({ id: command.id, ok: true, data: { contextId: original, previousContextId: fresh } }))) {
  let clock = 100_000;
  let index = 0;
  const fixture: ProfileRebindTransport = {
    status: vi.fn(async () => sequence[Math.min(index++, sequence.length - 1)]), submit,
    sleep: async ms => { clock += ms; }, now: () => clock, commandId: () => 'fixture-command',
  };
  return { fixture, submit };
}

describe('profile rebind validation and planning', () => {
  it.each(['default', '', 'UPPER123', 'short', 'with-dash', null, undefined])('rejects invalid context IDs: %s', value => {
    expect(isRebindContextId(value)).toBe(false);
  });
  it('requires the explicit connected source, matching expectation, and an offline original', () => {
    expect(validateProfileRebind(request, [fresh], 0)).toEqual(request);
    expect(() => validateProfileRebind({ ...request, contextId: undefined }, [fresh], 0)).toThrow();
    expect(() => validateProfileRebind({ ...request, preferredContextId: fresh }, [fresh], 0)).toThrow();
    expect(() => validateProfileRebind({ ...request, expectedContextId: other }, [fresh], 0)).toThrow();
    expect(() => validateProfileRebind(request, [fresh, original], 0)).toThrow('still connected');
    expect(() => validateProfileRebind(request, [], 0)).toThrow('not connected');
    expect(() => validateProfileRebind(request, [fresh], 1)).toThrow('in flight');
  });
  it('waits through the old-extension stop and selects only a unique offline/online pair', () => {
    expect(planProfileRebind([original, other], status(original, other))).toBeNull();
    expect(planProfileRebind([original, other], status(other))).toBeNull();
    expect(planProfileRebind([original, other], status(fresh, other))).toEqual(request);
    expect(() => planProfileRebind([original, other], status(fresh))).toThrow('ambiguous');
    expect(() => planProfileRebind([original], status(fresh, other))).toThrow('ambiguous');
    expect(() => planProfileRebind([original], status(original, fresh))).toThrow('ambiguous');
  });
  it('rejects malformed status and duplicate mappings', () => {
    expect(() => parseRebindStatus({ ok: true, profiles: [] })).toThrow();
    expect(() => parseRebindStatus(status(fresh, fresh))).toThrow('duplicate');
    expect(() => parseRebindStatus(status('default'))).toThrow();
    expect(() => planProfileRebind([original, original], status(original))).toThrow('unique');
  });
});

describe('batch rebind from explicit physical-profile bindings', () => {
  const newOther = 'new67890';
  const bindings = [{ contextId: original, expectedContextId: fresh }, { contextId: other, expectedContextId: newOther }];
  it('handles all old profiles offline and new profiles online in any enumeration order', async () => {
    const submit = vi.fn(async (command: { id: string; contextId: string; rebindContextId: string }) => ({ id: command.id, ok: true, data: { contextId: command.rebindContextId, previousContextId: command.contextId } }));
    const { fixture } = transport([status(newOther, fresh), status(fresh, newOther), status(original, newOther), status(newOther, original), status(other, original)], submit as any);
    const receipts = await batchProfileRebind(bindings, fixture);
    expect(receipts).toHaveLength(2);
    expect(submit.mock.calls.map(([command]) => [command.contextId, command.rebindContextId])).toEqual([[fresh, original], [newOther, other]]);
    expect(submit).toHaveBeenCalledTimes(2);
  });
  it.each([
    [{ contextId: original, expectedContextId: fresh }, { contextId: original, expectedContextId: newOther }],
    [{ contextId: original, expectedContextId: fresh }, { contextId: other, expectedContextId: fresh }],
    [{ contextId: original, expectedContextId: other }, { contextId: other, expectedContextId: fresh }],
    [{ contextId: original, expectedContextId: 'default' }],
  ])('rejects duplicate, overlapping, or invalid ID bindings before any submission: %s', async (...invalid) => {
    const { fixture, submit } = transport([status(fresh, newOther)]);
    await expect(batchProfileRebind(invalid, fixture)).rejects.toMatchObject({ code: 'profile_rebind_mapping_invalid' });
    expect(submit).not.toHaveBeenCalled();
  });
  it('requires every explicitly mapped new connection and rejects extra connections', async () => {
    for (const connections of [status(fresh), status(fresh, newOther, 'extra123')]) {
      const { fixture, submit } = transport([connections]);
      await expect(batchProfileRebind(bindings, fixture)).rejects.toMatchObject({ code: 'profile_rebind_batch_changed' });
      expect(submit).not.toHaveBeenCalled();
    }
  });
  it('does not retry a failed batch submission', async () => {
    const submit = vi.fn(async () => { throw new Error('fixture response lost'); });
    const { fixture } = transport([status(fresh, newOther)], submit);
    await expect(batchProfileRebind(bindings, fixture)).rejects.toThrow('fixture response lost');
    expect(submit).toHaveBeenCalledOnce();
  });
});

describe('profile watcher with fixture transport only', () => {
  it('submits one command and confirms the original ID after reload', async () => {
    const { fixture, submit } = transport([status(original), status(), status(fresh), status(fresh), status(fresh), status(original)]);
    const onVerified = vi.fn();
    const receipts = await watchProfileRebind([original], fixture, { onVerified });
    expect(submit).toHaveBeenCalledExactlyOnceWith({ ...request, action: 'profile-rebind', id: 'fixture-command' });
    expect(receipts).toEqual([{ ...request, id: 'fixture-command', verified: true }]);
    expect(onVerified).toHaveBeenCalledWith(receipts[0]);
  });
  it('can start after a unique old/new transition and still verifies a fresh second snapshot', async () => {
    const { fixture, submit } = transport([status(fresh), status(fresh), status(fresh), status(original)]);
    await watchProfileRebind([original], fixture);
    expect(submit).toHaveBeenCalledOnce();
  });
  it('stops without any POST if the confirmation snapshot changes', async () => {
    const { fixture, submit } = transport([status(original), status(fresh), status(original)]);
    await expect(watchProfileRebind([original], fixture)).rejects.toMatchObject({ code: 'profile_rebind_changed' });
    expect(submit).not.toHaveBeenCalled();
  });
  it('does not retry a lost or rejected POST', async () => {
    const submit = vi.fn(async () => { throw new Error('fixture response lost'); });
    const { fixture } = transport([status(original), status(fresh), status(fresh)], submit);
    await expect(watchProfileRebind([original], fixture)).rejects.toThrow('fixture response lost');
    expect(submit).toHaveBeenCalledOnce();
  });
  it('does not retry a missing acknowledgement', async () => {
    const submit = vi.fn(async () => ({ ok: false }));
    const { fixture } = transport([status(original), status(fresh), status(fresh)], submit as any);
    await expect(watchProfileRebind([original], fixture)).rejects.toMatchObject({ code: 'profile_rebind_ack_invalid' });
    expect(submit).toHaveBeenCalledOnce();
  });
  it('stops on readback timeout without submitting again', async () => {
    const { fixture, submit } = transport([status(original), status(fresh), status(fresh)]);
    await expect(watchProfileRebind([original], fixture, { readbackTimeoutMs: 1000 })).rejects.toMatchObject({ code: 'profile_rebind_readback_timeout' });
    expect(submit).toHaveBeenCalledOnce();
  });
  it('stops if another profile changes during readback', async () => {
    const { fixture, submit } = transport([status(original, other), status(fresh, other), status(fresh, other), status(fresh)]);
    await expect(watchProfileRebind([original, other], fixture)).rejects.toMatchObject({ code: 'profile_rebind_readback_ambiguous' });
    expect(submit).toHaveBeenCalledOnce();
  });
  it('stops before submission when any command is pending', async () => {
    const { fixture, submit } = transport([{ ...status(original), pending: 1 }]);
    await expect(watchProfileRebind([original], fixture)).rejects.toMatchObject({ code: 'profile_rebind_busy' });
    expect(submit).not.toHaveBeenCalled();
  });
});
