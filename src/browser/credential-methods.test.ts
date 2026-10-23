import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ send: vi.fn(), sendFull: vi.fn(), entries: vi.fn(), credential: vi.fn(), click: vi.fn() }));
vi.mock('./daemon-client.js', () => ({ sendCommand: mocks.send, sendCommandFull: mocks.sendFull }));
vi.mock('./autofill.js', async () => ({
  ...await vi.importActual<typeof import('./autofill.js')>('./autofill.js'),
  loadBrowserAutofillEntries: mocks.entries,
  readBrowserAutofillCredential: mocks.credential,
}));
vi.mock('./system-input.js', async () => ({
  ...await vi.importActual<typeof import('./system-input.js')>('./system-input.js'),
  clickScreenPoint: mocks.click,
}));
import { Page } from './page.js';

const fixture = { username: 'fixture-user', password: 'fixture-password', allowedHosts: ['taobao.com'], submit: false };
const entry = { id: 'fixture', contextId: 'fixture-profile', allowedHosts: ['taobao.com'], keychain: { service: 'fixture', account: 'fixture', format: 'json' } };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.entries.mockReturnValue([]);
  mocks.sendFull.mockResolvedValue({ page: 'fixture-page' });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('credential methods with mocked transport and keychain', () => {
  it('uses the dedicated fill action with exact profile and page identity', async () => {
    const page = new Page('fixture-session', undefined, 'fixture-profile', 'background', 'adapter', 'persistent');
    page.setActivePage('fixture-page');
    const result = { ok: true, username_filled: true, password_filled: true, submitted: false };
    mocks.send.mockResolvedValue(result);
    expect(await page.fillCredentials(fixture)).toBe(result);
    expect(mocks.send).toHaveBeenCalledWith('credential-fill', expect.objectContaining({
      ...fixture, session: 'fixture-session', contextId: 'fixture-profile', page: 'fixture-page', windowMode: 'background', siteSession: 'persistent',
    }));
  });

  it('fills a matching profile after navigation using mocked credentials', async () => {
    mocks.entries.mockReturnValue([entry]);
    mocks.credential.mockReturnValue(fixture);
    mocks.send.mockResolvedValueOnce('https://login.taobao.com/fixture')
      .mockResolvedValueOnce({ username_filled: true, password_filled: true });
    const page = new Page('fixture-session', undefined, 'fixture-profile');
    await page.goto('https://qn.taobao.com/fixture', { waitUntil: 'none' });
    expect(mocks.credential).toHaveBeenCalledWith(entry);
    expect(mocks.send).toHaveBeenCalledWith('credential-fill', expect.objectContaining({ ...fixture, page: 'fixture-page' }));
  });

  it('does not read credentials from another profile', async () => {
    mocks.entries.mockReturnValue([entry]);
    mocks.send.mockResolvedValue('https://login.taobao.com/fixture');
    await new Page('fixture-session', undefined, 'other-profile').goto('https://login.taobao.com/fixture', { waitUntil: 'none' });
    expect(mocks.credential).not.toHaveBeenCalled();
    expect(mocks.send.mock.calls.some(([action]) => action === 'credential-fill')).toBe(false);
  });

  it('does not inspect configuration without an explicitly pinned profile', async () => {
    await new Page('fixture-session').goto('https://login.taobao.com/fixture', { waitUntil: 'none' });
    expect(mocks.entries).not.toHaveBeenCalled();
    expect(mocks.credential).not.toHaveBeenCalled();
  });

  it('systemClick maps viewport coordinates only after visibility succeeds', async () => {
    mocks.send.mockResolvedValueOnce('visible').mockResolvedValueOnce({ screenX: 100, screenY: 50, outerWidth: 1200, outerHeight: 900, innerWidth: 1180, innerHeight: 760 });
    await new Page('fixture-session').systemClick(90, 200);
    expect(mocks.click).toHaveBeenCalledWith({ x: 200, y: 380 });
  });

  it('systemClick preserves upstream protection for hidden tabs', async () => {
    mocks.send.mockResolvedValueOnce('hidden');
    await expect(new Page('fixture-session').systemClick(90, 200)).rejects.toThrow();
    expect(mocks.click).not.toHaveBeenCalled();
  });
});


describe('background CDP and system input separation', () => {
  const modes = [
    ['OPENCLI_WINDOW', 'background'],
    ['OPENCLI_BROWSER_WINDOW_MODE', 'background'],
    ['OPENCLI_TAB_PLACEMENT', 'existing-window'],
  ] as const;

  it.each(modes)('allows hidden CDP mouse and keyboard with %s', async (key, value) => {
    vi.stubEnv(key, value);
    mocks.send.mockResolvedValue({});
    const page = new Page('fixture-session');
    await page.nativeClick(10, 20);
    await page.nativeKeyPress('Enter');
    const dispatch = mocks.send.mock.calls.filter(([action]) => action === 'cdp');
    expect(dispatch).toHaveLength(5);
    expect(dispatch.every(([, options]) => options.cdpMethod.startsWith('Input.dispatch'))).toBe(true);
    expect(mocks.click).not.toHaveBeenCalled();
    expect(mocks.send.mock.calls.some(([action]) => action === 'exec')).toBe(false);
  });

  it.each(modes)('still blocks hidden system mouse with %s', async (key, value) => {
    vi.stubEnv(key, value);
    mocks.send.mockResolvedValue('hidden');
    await expect(new Page('fixture-session').systemClick(10, 20)).rejects.toMatchObject({code: 'COMMAND_EXEC'});
    expect(mocks.click).not.toHaveBeenCalled();
  });

  it('keeps system input visible-only with foreground plus existing-window', async () => {
    vi.stubEnv('OPENCLI_WINDOW', 'foreground');
    vi.stubEnv('OPENCLI_TAB_PLACEMENT', 'existing-window');
    mocks.send.mockResolvedValue('hidden');
    const page = new Page('fixture-session');
    await expect(page.systemClick(10, 20)).rejects.toMatchObject({code: 'COMMAND_EXEC'});
    expect(mocks.click).not.toHaveBeenCalled();
    mocks.send.mockResolvedValueOnce('visible').mockResolvedValueOnce({ screenX: 0, screenY: 0, outerWidth: 100, outerHeight: 100, innerWidth: 100, innerHeight: 100 });
    await page.systemClick(10, 20);
    expect(mocks.click).toHaveBeenCalledTimes(1);
  });

  it('blocks hidden CDP input outside the approved background modes', async () => {
    for (const key of ['OPENCLI_WINDOW','OPENCLI_BROWSER_WINDOW_MODE','OPENCLI_TAB_PLACEMENT']) vi.stubEnv(key, undefined);
    mocks.send.mockResolvedValue('hidden');
    const page = new Page('fixture-session');
    await expect(page.nativeClick(10, 20)).rejects.toMatchObject({code: 'COMMAND_EXEC'});
    await expect(page.nativeKeyPress('Enter')).rejects.toMatchObject({code: 'COMMAND_EXEC'});
    expect(mocks.send.mock.calls.some(([action]) => action === 'cdp')).toBe(false);
  });
});
