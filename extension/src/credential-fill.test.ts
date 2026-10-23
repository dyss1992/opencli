import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { credentialFillInFrame } from './credential-fill-frame';
import { normalizeCredentialFillRequest, runCredentialFillOnTab } from './credential-fill';

afterEach(() => vi.unstubAllGlobals());

const fixture = { username: 'fixture-user', password: 'fixture-password', allowedHosts: ['taobao.com'], submit: false };

function loginFrame(url = 'https://login.taobao.com/fixture') {
  const dom = new JSDOM('<form><input id="fm-login-id"><input id="fm-login-password" type="password"><button type="submit">登录</button></form>', { url });
  for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'InputEvent', 'Event', 'FocusEvent', 'KeyboardEvent'] as const) {
    vi.stubGlobal(key, key === 'window' ? dom.window : key === 'document' ? dom.window.document : dom.window[key]);
  }
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, width: 120, height: 30, top: 0, left: 0, bottom: 30, right: 120, toJSON: () => ({}) });
  const submitted = vi.fn((event: Event) => event.preventDefault());
  dom.window.document.querySelector('form')!.addEventListener('submit', submitted);
  return { dom, submitted };
}

describe('credential fill with synthetic login forms', () => {
  it('requires an explicit allowed host list', () => {
    expect(normalizeCredentialFillRequest({ username: 'fixture', password: 'fixture' })).toBeNull();
    expect(normalizeCredentialFillRequest(fixture)?.submit).toBe(false);
  });

  it('fills allowed inputs and returns only status, without submitting', async () => {
    const { dom, submitted } = loginFrame();
    const result = await credentialFillInFrame(normalizeCredentialFillRequest(fixture)!);
    expect(dom.window.document.querySelector<HTMLInputElement>('#fm-login-id')!.value).toBe(fixture.username);
    expect(dom.window.document.querySelector<HTMLInputElement>('#fm-login-password')!.value).toBe(fixture.password);
    expect(result).toMatchObject({ ok: true, username_filled: true, password_filled: true, submitted: false });
    expect(JSON.stringify(result)).not.toContain(fixture.password);
    expect(JSON.stringify(result)).not.toContain(fixture.username);
    expect(submitted).not.toHaveBeenCalled();
    dom.window.close();
  });

  it('supports explicit submit on a local fixture', async () => {
    const { dom, submitted } = loginFrame();
    const result = await credentialFillInFrame(normalizeCredentialFillRequest({ ...fixture, submit: true })!);
    expect(result.submitted).toBe(true);
    expect(submitted).toHaveBeenCalledOnce();
    dom.window.close();
  });

  it('rejects lookalike hosts before touching the form', async () => {
    const { dom } = loginFrame('https://taobao.com.evil.invalid/fixture');
    const result = await credentialFillInFrame(normalizeCredentialFillRequest(fixture)!);
    expect(result.reason).toBe('host_not_allowed');
    expect(dom.window.document.querySelector<HTMLInputElement>('#fm-login-password')!.value).toBe('');
    dom.window.close();
  });

  it('selects the successful frame and removes unexpected secret fields', async () => {
    const good = { ok: true, host: 'login.taobao.com', username_filled: true, password_filled: true, submitted: false };
    const executeScript = vi.fn().mockResolvedValue([
      { frameId: 0, result: { ...good, ok: false, reason: 'host_not_allowed' } },
      { frameId: 3, result: { ...good, password: fixture.password } },
    ]);
    vi.stubGlobal('chrome', { scripting: { executeScript } });
    expect(await runCredentialFillOnTab(7, normalizeCredentialFillRequest(fixture)!)).toEqual({ frameId: 3, result: good });
    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 7, allFrames: true }, world: 'MAIN' }));
  });
});
