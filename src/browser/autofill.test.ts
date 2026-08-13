import { describe, expect, it } from 'vitest';
import {
  chromeExtensionIdFromOrigin,
  isBrowserAutofillExtensionAllowed,
  isCredentialBearingAction,
  parseBrowserAutofillConfig,
  parseStoredBrowserCredential,
  selectBrowserAutofillEntry,
  type BrowserAutofillEntry,
} from './autofill.js';

const ALLOWED_EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
const OTHER_EXTENSION_ID = 'ponmlkjihgfedcbaponmlkjihgfedcba';

const entries: BrowserAutofillEntry[] = [
  {
    id: 'work-taobao',
    contextId: 'work-profile',
    allowedHosts: ['taobao.com'],
    matchHosts: ['login.taobao.com'],
    keychain: { service: 'opencli-work', account: 'seller', format: 'json' },
  },
  {
    id: 'personal-taobao',
    contextId: 'personal-profile',
    allowedHosts: ['taobao.com'],
    matchHosts: ['login.taobao.com'],
    keychain: { service: 'opencli-personal', account: 'buyer', format: 'json' },
  },
];

describe('browser autofill configuration', () => {
  it('extracts only a canonical Chrome extension ID from the WebSocket origin', () => {
    expect(chromeExtensionIdFromOrigin(`chrome-extension://${ALLOWED_EXTENSION_ID}`)).toBe(ALLOWED_EXTENSION_ID);
    expect(chromeExtensionIdFromOrigin(undefined)).toBeNull();
    expect(chromeExtensionIdFromOrigin('https://example.com')).toBeNull();
    expect(chromeExtensionIdFromOrigin(`chrome-extension://${ALLOWED_EXTENSION_ID}/path`)).toBeNull();
    expect(chromeExtensionIdFromOrigin('chrome-extension://claimed-by-client')).toBeNull();
  });

  it('allows credentials only for an extension ID in the configured allowlist', () => {
    expect(isBrowserAutofillExtensionAllowed(ALLOWED_EXTENSION_ID, [ALLOWED_EXTENSION_ID])).toBe(true);
    expect(isBrowserAutofillExtensionAllowed(OTHER_EXTENSION_ID, [ALLOWED_EXTENSION_ID])).toBe(false);
    expect(isBrowserAutofillExtensionAllowed(null, [ALLOWED_EXTENSION_ID])).toBe(false);
    expect(isBrowserAutofillExtensionAllowed(ALLOWED_EXTENSION_ID, [])).toBe(false);
  });

  it('treats a missing top-level allowedExtensionIds field as deny-all', () => {
    const config = parseBrowserAutofillConfig({ entries });

    expect(config.allowedExtensionIds).toEqual([]);
    expect(config.entries).toHaveLength(2);
  });

  it('parses valid extension IDs from the top-level allowlist', () => {
    const config = parseBrowserAutofillConfig({
      allowedExtensionIds: [` ${ALLOWED_EXTENSION_ID} `, OTHER_EXTENSION_ID, 'invalid'],
      entries,
    });

    expect(config.allowedExtensionIds).toEqual([ALLOWED_EXTENSION_ID, OTHER_EXTENSION_ID]);
  });

  it('identifies every command action that can carry credentials', () => {
    expect(isCredentialBearingAction('credential-fill')).toBe(true);
    expect(isCredentialBearingAction('credential-autofill')).toBe(true);
    expect(isCredentialBearingAction('exec')).toBe(false);
    expect(isCredentialBearingAction(undefined)).toBe(false);
  });

  it('selects credentials only from the requesting browser profile', () => {
    const selected = selectBrowserAutofillEntry(entries, 'work-profile', 'https://login.taobao.com/member/login.jhtml');

    expect(selected?.id).toBe('work-taobao');
  });

  it('does not fall back to another profile with the same login host', () => {
    const selected = selectBrowserAutofillEntry(entries, 'unknown-profile', 'https://login.taobao.com/member/login.jhtml');

    expect(selected).toBeNull();
  });

  it('rejects unrelated and non-http URLs', () => {
    expect(selectBrowserAutofillEntry(entries, 'work-profile', 'https://evil.example/login')).toBeNull();
    expect(selectBrowserAutofillEntry(entries, 'work-profile', 'chrome://settings')).toBeNull();
  });

  it('parses plain and hex-encoded JSON credentials', () => {
    const json = JSON.stringify({ username: 'seller', password: 'secret' });

    expect(parseStoredBrowserCredential(json)).toEqual({ username: 'seller', password: 'secret' });
    expect(parseStoredBrowserCredential(Buffer.from(json).toString('hex'))).toEqual({ username: 'seller', password: 'secret' });
  });

  it('rejects incomplete credentials', () => {
    expect(parseStoredBrowserCredential(JSON.stringify({ username: 'seller' }))).toBeNull();
  });
});
