import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  http: undefined as ((req: any, res: any) => void) | undefined,
  connection: undefined as ((ws: any, req: any) => void) | undefined,
  verify: undefined as ((input: any) => boolean) | undefined,
  config: vi.fn(), credential: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
}));
vi.mock('node:http', () => ({ createServer: (handler: typeof state.http) => {
  state.http = handler;
  return { listen: vi.fn(), on: vi.fn() };
} }));
vi.mock('ws', () => ({
  WebSocket: class { static OPEN = 1; },
  WebSocketServer: class {
    constructor(options: any) { state.verify = options.verifyClient; }
    on(event: string, handler: typeof state.connection) { if (event === 'connection') state.connection = handler; }
  },
}));
vi.mock('./logger.js', () => ({ log: { info: state.info, warn: state.warn, error: state.error } }));
vi.mock('./update-check.js', () => ({ recordExtensionVersion: vi.fn() }));
vi.mock('./browser/autofill.js', async () => ({
  ...await vi.importActual<typeof import('./browser/autofill.js')>('./browser/autofill.js'),
  loadBrowserAutofillConfig: state.config,
  readBrowserAutofillCredential: state.credential,
}));

const allowedId = 'abcdefghijklmnopabcdefghijklmnop';
const otherId = 'ponmlkjihgfedcbaponmlkjihgfedcba';
const fixture = { username: 'fixture-user', password: 'fixture-password' };

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubEnv('OPENCLI_DAEMON_PORT', undefined);
  vi.spyOn(process, 'on').mockReturnValue(process);
  state.config.mockReturnValue({ allowedExtensionIds: [allowedId], entries: [{
    id: 'fixture', contextId: 'fixture-profile', allowedHosts: ['taobao.com'], matchHosts: ['login.taobao.com'],
    keychain: { service: 'fixture', account: 'fixture', format: 'json' }, submit: true,
  }] });
  state.credential.mockReturnValue(fixture);
  await import('./daemon.js');
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function connect(origin: string | undefined, contextId = 'fixture-profile', hello = true) {
  const socket = Object.assign(new EventEmitter(), {
    readyState: 1, send: vi.fn(), close: vi.fn(), ping: vi.fn(), terminate: vi.fn(),
  });
  state.connection!(socket, { headers: { origin } });
  if (hello) socket.emit('message', Buffer.from(JSON.stringify({ type: 'hello', contextId })));
  return socket;
}

function request(socket: ReturnType<typeof connect>, fields: object = {}) {
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'autofill-request', requestId: 'fixture-request', url: 'https://login.taobao.com/fixture', ...fields })));
  return JSON.parse(socket.send.mock.calls.at(-1)![0]);
}

async function command(body: object | string) {
  const req = Object.assign(new EventEmitter(), { method: 'POST', url: '/command', headers: { 'x-opencli': '1' } });
  const res = Object.assign(new EventEmitter(), { writeHead: vi.fn(), end: vi.fn() });
  state.http!(req, res);
  req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
  req.emit('end');
  for (let count = 0; count < 8; count++) await Promise.resolve();
  return res;
}

describe('daemon credential transport without sockets, configuration files, or keychain access', () => {
  it('accepts only canonical extension origins or the existing originless transport', () => {
    for (const origin of [undefined, `chrome-extension://${allowedId}`]) expect(state.verify!({ req: { headers: { origin } } })).toBe(true);
    for (const origin of ['https://example.invalid', 'chrome-extension://invalid', `chrome-extension://${allowedId}/path`]) expect(state.verify!({ req: { headers: { origin } } })).toBe(false);
  });

  it.each([undefined, `chrome-extension://${otherId}`])('denies credentials to an unapproved socket: %s', origin => {
    expect(request(connect(origin))).toMatchObject({ ok: false, error: 'autofill_not_authorized' });
    expect(state.credential).not.toHaveBeenCalled();
  });

  it('requires a registered profile and ignores claimed request context IDs', () => {
    expect(request(connect(`chrome-extension://${allowedId}`, 'fixture-profile', false))).toMatchObject({ ok: false });
    expect(request(connect(`chrome-extension://${allowedId}`, 'other-profile'), { contextId: 'fixture-profile' })).toMatchObject({ ok: false, error: 'no_matching_autofill_entry' });
    expect(state.credential).not.toHaveBeenCalled();
  });

  it('returns only the matching profile credential and forces passive submit off', () => {
    expect(request(connect(`chrome-extension://${allowedId}`))).toMatchObject({ ok: true, credential: { ...fixture, submit: false } });
    expect(state.credential).toHaveBeenCalledOnce();
  });

  it('denies a lookalike login hostname without reading the keychain', () => {
    expect(request(connect(`chrome-extension://${allowedId}`), { url: 'https://taobao.com.evil.invalid' })).toMatchObject({ ok: false });
    expect(state.credential).not.toHaveBeenCalled();
  });

  it('rejects explicit credential commands before dispatch to unapproved extensions', async () => {
    const socket = connect(`chrome-extension://${otherId}`);
    const res = await command({ id: 'fixture-command', action: 'credential-fill', contextId: 'fixture-profile', ...fixture });
    expect(res.writeHead).toHaveBeenCalledWith(403, expect.anything());
    expect(JSON.parse(res.end.mock.calls[0][0])).toMatchObject({ errorCode: 'credential_transport_not_authorized' });
    expect(socket.send).not.toHaveBeenCalled();
  });

  it('dispatches explicit credential commands only to an approved extension', async () => {
    const socket = connect(`chrome-extension://${allowedId}`);
    const res = await command({ id: 'fixture-command', action: 'credential-fill', contextId: 'fixture-profile', ...fixture });
    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('credential-fill'), expect.any(Function));
    socket.emit('message', Buffer.from(JSON.stringify({ id: 'fixture-command', ok: true, data: { password_filled: true } })));
    for (let count = 0; count < 8; count++) await Promise.resolve();
    expect(JSON.parse(res.end.mock.calls[0][0])).toMatchObject({ ok: true, data: { password_filled: true } });
  });

  it('does not include malformed credential input in logs or error responses', async () => {
    const malformed = '{"password":"fixture-password", broken';
    connect(`chrome-extension://${allowedId}`).emit('message', Buffer.from(malformed));
    const res = await command(malformed);
    expect(JSON.stringify(state.warn.mock.calls)).not.toContain(fixture.password);
    expect(JSON.stringify(res.end.mock.calls)).not.toContain(fixture.password);
  });
});

describe('daemon profile rebind with mocked sockets only', () => {
  const rebind = { id: 'rebind-fixture', action: 'profile-rebind', contextId: 'new12345', expectedContextId: 'new12345', rebindContextId: 'old12345' };

  it('routes explicitly to the new connection without a page session or credential access', async () => {
    const socket = connect(`chrome-extension://${otherId}`, 'new12345');
    const res = await command(rebind);
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify(rebind), expect.any(Function));
    socket.emit('message', Buffer.from(JSON.stringify({ id: rebind.id, ok: true, data: { contextId: 'old12345', previousContextId: 'new12345' } })));
    for (let count = 0; count < 8; count++) await Promise.resolve();
    expect(JSON.parse(res.end.mock.calls[0][0])).toMatchObject({ ok: true, data: { contextId: 'old12345' } });
    expect(state.config).not.toHaveBeenCalled();
    expect(state.credential).not.toHaveBeenCalled();
  });

  it.each([
    { contextId: undefined }, { expectedContextId: 'oth12345' }, { rebindContextId: 'default' }, { preferredContextId: 'new12345' },
  ])('rejects implicit routing or invalid expectations before dispatch: %s', async change => {
    const socket = connect(undefined, 'new12345');
    const res = await command({ ...rebind, ...change });
    expect(JSON.parse(res.end.mock.calls[0][0])).toMatchObject({ ok: false, errorCode: 'profile_rebind_invalid' });
    expect(socket.send).not.toHaveBeenCalled();
  });

  it('does not rebind while the original ID remains online', async () => {
    const socket = connect(undefined, 'new12345');
    connect(undefined, 'old12345');
    const res = await command(rebind);
    expect(JSON.parse(res.end.mock.calls[0][0])).toMatchObject({ errorCode: 'profile_rebind_target_online' });
    expect(socket.send).not.toHaveBeenCalled();
  });

  it('requires all existing commands to settle before rebind', async () => {
    const socket = connect(undefined, 'new12345');
    await command({ id: 'work', action: 'exec', contextId: 'new12345', session: 'fixture', code: '1' });
    const res = await command(rebind);
    expect(JSON.parse(res.end.mock.calls[0][0])).toMatchObject({ errorCode: 'profile_rebind_busy' });
    expect(socket.send).toHaveBeenCalledOnce();
    socket.emit('message', Buffer.from(JSON.stringify({ id: 'work', ok: true })));
  });

  it('blocks other command dispatch while rebind is awaiting acknowledgement', async () => {
    const socket = connect(undefined, 'new12345');
    await command(rebind);
    const res = await command({ id: 'work', action: 'exec', contextId: 'new12345', session: 'fixture', code: '1' });
    expect(JSON.parse(res.end.mock.calls[0][0])).toMatchObject({ errorCode: 'profile_rebind_busy' });
    expect(socket.send).toHaveBeenCalledOnce();
    socket.emit('message', Buffer.from(JSON.stringify({ id: rebind.id, ok: true })));
  });
});
