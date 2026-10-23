export interface ProfileRebindRequest {
  contextId: string;
  expectedContextId: string;
  rebindContextId: string;
}

export class ProfileRebindError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export function isRebindContextId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9]{8}$/.test(value);
}

export function validateProfileRebind(
  value: Record<string, unknown>, connectedContextIds: readonly string[], pendingCount: number,
): ProfileRebindRequest {
  const { contextId, expectedContextId, rebindContextId } = value;
  if (!isRebindContextId(contextId) || !isRebindContextId(expectedContextId) || !isRebindContextId(rebindContextId)
    || contextId !== expectedContextId || contextId === rebindContextId || value.preferredContextId !== undefined) {
    throw new ProfileRebindError('profile_rebind_invalid', 'Use explicit, different eight-character profile IDs and match expectedContextId to contextId.');
  }
  if (pendingCount !== 0) throw new ProfileRebindError('profile_rebind_busy', 'Commands are still in flight. Stop and inspect before rebinding.');
  if (!connectedContextIds.includes(contextId)) throw new ProfileRebindError('profile_rebind_source_offline', 'The explicitly selected new profile is not connected.');
  if (connectedContextIds.includes(rebindContextId)) throw new ProfileRebindError('profile_rebind_target_online', 'The original profile is still connected. Stop its old extension first.');
  return { contextId, expectedContextId, rebindContextId };
}

export interface RebindStatus { ok: true; pending: number; profiles: Array<{ contextId: string }> }

export function parseRebindStatus(value: unknown): RebindStatus {
  const status = value as Partial<RebindStatus> | null;
  if (!status || status.ok !== true || !Number.isInteger(status.pending) || status.pending! < 0 || !Array.isArray(status.profiles)
    || status.profiles.some(profile => !profile || !isRebindContextId(profile.contextId))) {
    throw new ProfileRebindError('profile_rebind_status_invalid', 'The daemon returned an incomplete profile status.');
  }
  const ids = status.profiles.map(profile => profile.contextId);
  if (new Set(ids).size !== ids.length) throw new ProfileRebindError('profile_rebind_status_invalid', 'The daemon returned duplicate profile IDs.');
  return status as RebindStatus;
}

export function planProfileRebind(knownIds: readonly string[], status: RebindStatus): ProfileRebindRequest | null {
  if (!knownIds.length || knownIds.some(id => !isRebindContextId(id)) || new Set(knownIds).size !== knownIds.length) {
    throw new ProfileRebindError('profile_rebind_mapping_invalid', 'Use a nonempty list of unique original profile IDs.');
  }
  if (status.pending !== 0) throw new ProfileRebindError('profile_rebind_busy', 'Commands are still in flight. Stop and inspect before rebinding.');
  const connected = status.profiles.map(profile => profile.contextId);
  const missing = knownIds.filter(id => !connected.includes(id));
  const added = connected.filter(id => !knownIds.includes(id));
  if (missing.length > 1 || added.length > 1 || (added.length === 1 && missing.length !== 1)) {
    throw new ProfileRebindError('profile_rebind_ambiguous', 'Profile changes are ambiguous. Stop and inspect; do not retry the rebind.');
  }
  return missing.length === 1 && added.length === 1
    ? { contextId: added[0], expectedContextId: added[0], rebindContextId: missing[0] } : null;
}

export interface ProfileRebindTransport {
  status(): Promise<unknown>;
  submit(command: ProfileRebindRequest & { id: string; action: 'profile-rebind' }): Promise<unknown>;
  sleep(ms: number): Promise<void>;
  now(): number;
  commandId(): string;
}

export interface ProfileRebindReceipt extends ProfileRebindRequest { id: string; verified: true }

/** Each binding comes from the same physical Chrome profile's public context key. */
export interface ProfileRebindBinding { contextId: string; expectedContextId: string }

export async function batchProfileRebind(
  bindings: readonly ProfileRebindBinding[], transport: ProfileRebindTransport,
  options: { timeoutMs?: number; pollMs?: number; readbackTimeoutMs?: number; onReady?: () => void; onVerified?: (receipt: ProfileRebindReceipt) => void } = {},
): Promise<ProfileRebindReceipt[]> {
  const originals = bindings.map(binding => binding?.contextId);
  const fresh = bindings.map(binding => binding?.expectedContextId);
  if (!bindings.length || [...originals, ...fresh].some(id => !isRebindContextId(id))
    || new Set(originals).size !== bindings.length || new Set(fresh).size !== bindings.length
    || fresh.some(id => originals.includes(id))) {
    throw new ProfileRebindError('profile_rebind_mapping_invalid', 'Use unique original and new profile IDs from each physical Chrome profile. The two ID sets must be disjoint.');
  }
  const timeoutMs = options.timeoutMs ?? 30 * 60_000;
  const pollMs = options.pollMs ?? 500;
  const readbackTimeoutMs = options.readbackTimeoutMs ?? 15_000;
  if (![timeoutMs, pollMs, readbackTimeoutMs].every(ms => Number.isFinite(ms) && ms > 0)) throw new ProfileRebindError('profile_rebind_options_invalid', 'Timeout and polling intervals must be positive.');
  const deadline = transport.now() + timeoutMs;
  const receipts: ProfileRebindReceipt[] = [];
  const expected = new Set(fresh);
  const assertExactConnections = (status: RebindStatus) => {
    const ids = status.profiles.map(profile => profile.contextId);
    if (status.pending !== 0 || ids.length !== expected.size || ids.some(id => !expected.has(id))) {
      throw new ProfileRebindError('profile_rebind_batch_changed', 'Connected profiles do not match the explicit physical-profile mapping, or commands are pending. Stop and inspect.');
    }
  };
  assertExactConnections(parseRebindStatus(await transport.status()));
  options.onReady?.();
  for (const binding of bindings) {
    if (transport.now() >= deadline) throw new ProfileRebindError('profile_rebind_timeout', 'Profile migration timed out. Stop and inspect.');
    const before = parseRebindStatus(await transport.status());
    assertExactConnections(before);
    const plan = validateProfileRebind({ contextId: binding.expectedContextId, expectedContextId: binding.expectedContextId, rebindContextId: binding.contextId }, before.profiles.map(profile => profile.contextId), before.pending);
    const id = transport.commandId();
    const reply = await transport.submit({ ...plan, id, action: 'profile-rebind' }) as { id?: unknown; ok?: unknown; data?: { contextId?: unknown; previousContextId?: unknown } } | null;
    if (!reply || reply.ok !== true || reply.id !== id || reply.data?.contextId !== plan.rebindContextId || reply.data.previousContextId !== plan.contextId) {
      throw new ProfileRebindError('profile_rebind_ack_invalid', 'Rebind acknowledgement is missing or inconsistent. Stop and inspect; do not submit again.');
    }
    const readbackDeadline = Math.min(deadline, transport.now() + readbackTimeoutMs);
    let verified = false;
    while (transport.now() < readbackDeadline) {
      const after = parseRebindStatus(await transport.status());
      const connected = after.profiles.map(profile => profile.contextId);
      const others = [...expected].filter(current => current !== plan.contextId);
      if (after.pending !== 0 || others.some(current => !connected.includes(current))
        || connected.some(current => !expected.has(current) && current !== plan.rebindContextId)
        || (connected.includes(plan.contextId) && connected.includes(plan.rebindContextId))) {
        throw new ProfileRebindError('profile_rebind_readback_ambiguous', 'Profile connections changed outside the explicit binding during readback. Stop and inspect.');
      }
      if (connected.includes(plan.rebindContextId) && !connected.includes(plan.contextId)) { verified = true; break; }
      await transport.sleep(pollMs);
    }
    if (!verified) throw new ProfileRebindError('profile_rebind_readback_timeout', 'The original profile ID did not reconnect in time. Stop and inspect; do not submit again.');
    expected.delete(plan.contextId);
    expected.add(plan.rebindContextId);
    const receipt: ProfileRebindReceipt = { ...plan, id, verified: true };
    receipts.push(receipt);
    options.onVerified?.(receipt);
  }
  return receipts;
}

export async function watchProfileRebind(
  knownIds: readonly string[], transport: ProfileRebindTransport,
  options: { timeoutMs?: number; pollMs?: number; readbackTimeoutMs?: number; onReady?: () => void; onVerified?: (receipt: ProfileRebindReceipt) => void } = {},
): Promise<ProfileRebindReceipt[]> {
  const timeoutMs = options.timeoutMs ?? 30 * 60_000;
  const pollMs = options.pollMs ?? 500;
  const readbackTimeoutMs = options.readbackTimeoutMs ?? 15_000;
  if (![timeoutMs, pollMs, readbackTimeoutMs].every(ms => Number.isFinite(ms) && ms > 0)) {
    throw new ProfileRebindError('profile_rebind_options_invalid', 'Timeout and polling intervals must be positive.');
  }
  const initial = parseRebindStatus(await transport.status());
  planProfileRebind(knownIds, initial);
  const deadline = transport.now() + timeoutMs;
  const receipts: ProfileRebindReceipt[] = [];
  const submitted = new Set<string>();
  options.onReady?.();
  while (transport.now() < deadline) {
    const status = parseRebindStatus(await transport.status());
    const plan = planProfileRebind(knownIds, status);
    if (!plan) { await transport.sleep(pollMs); continue; }
    if (submitted.has(plan.rebindContextId)) throw new ProfileRebindError('profile_rebind_already_submitted', 'This original profile was already rebound. Stop and inspect.');
    const confirmed = planProfileRebind(knownIds, parseRebindStatus(await transport.status()));
    if (!confirmed || JSON.stringify(confirmed) !== JSON.stringify(plan)) throw new ProfileRebindError('profile_rebind_changed', 'The profile connections changed before submission. Stop and inspect.');
    const id = transport.commandId();
    submitted.add(plan.rebindContextId);
    // Intentionally one POST, without transport or outcome retries.
    const reply = await transport.submit({ ...plan, id, action: 'profile-rebind' }) as { id?: unknown; ok?: unknown; data?: { contextId?: unknown; previousContextId?: unknown } } | null;
    if (!reply || reply.ok !== true || reply.id !== id || reply.data?.contextId !== plan.rebindContextId || reply.data.previousContextId !== plan.contextId) {
      throw new ProfileRebindError('profile_rebind_ack_invalid', 'Rebind acknowledgement is missing or inconsistent. Stop and inspect; do not submit again.');
    }
    const readbackDeadline = Math.min(deadline, transport.now() + readbackTimeoutMs);
    let verified = false;
    while (transport.now() < readbackDeadline) {
      const after = parseRebindStatus(await transport.status());
      const ids = after.profiles.map(profile => profile.contextId);
      if (after.pending !== 0 || knownIds.some(old => old !== plan.rebindContextId && !ids.includes(old))
        || ids.some(current => !knownIds.includes(current) && current !== plan.contextId)) {
        throw new ProfileRebindError('profile_rebind_readback_ambiguous', 'Other profile connections changed during readback. Stop and inspect.');
      }
      if (ids.includes(plan.rebindContextId) && !ids.includes(plan.contextId)) { verified = true; break; }
      await transport.sleep(pollMs);
    }
    if (!verified) throw new ProfileRebindError('profile_rebind_readback_timeout', 'The original profile ID did not reconnect in time. Stop and inspect; do not submit again.');
    const receipt: ProfileRebindReceipt = { ...plan, id, verified: true };
    receipts.push(receipt);
    options.onVerified?.(receipt);
    if (receipts.length === knownIds.length) return receipts;
  }
  throw new ProfileRebindError('profile_rebind_timeout', 'Profile migration timed out. Stop and inspect; completed profiles remain recorded.');
}
