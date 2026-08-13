import { credentialFillInFrame, type CredentialFillFrameResult, type CredentialFillRequest } from './credential-fill-frame';

const DEFAULT_USERNAME_SELECTORS = [
  '#fm-login-id',
  'input[name="fm-login-id"]',
  'input[autocomplete="username"]',
  'input[type="email"]',
  'input[type="text"]',
];
const DEFAULT_PASSWORD_SELECTORS = [
  '#fm-login-password',
  'input[name="fm-login-password"]',
  'input[autocomplete="current-password"]',
  'input[type="password"]',
];
const DEFAULT_LOGIN_ACTIVATION_TEXT = ['账号密码登录', '密码登录', '账号登录'];
const DEFAULT_SUBMIT_SELECTORS = ['button[type="submit"]', 'input[type="submit"]', 'button', 'a'];

function cleanStringArray(value: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const cleaned = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return cleaned.length > 0 ? cleaned : [...fallback];
}

export function normalizeCredentialFillRequest(
  value: unknown,
  defaultSubmit: boolean = true,
): CredentialFillRequest | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.username !== 'string' || typeof record.password !== 'string') return null;
  const allowedHosts = cleanStringArray(record.allowedHosts, []);
  if (allowedHosts.length === 0) return null;
  return {
    username: record.username,
    password: record.password,
    allowedHosts,
    usernameSelectors: cleanStringArray(record.usernameSelectors, DEFAULT_USERNAME_SELECTORS),
    passwordSelectors: cleanStringArray(record.passwordSelectors, DEFAULT_PASSWORD_SELECTORS),
    activateTextPatterns: cleanStringArray(record.activateTextPatterns, DEFAULT_LOGIN_ACTIVATION_TEXT),
    submitSelectors: cleanStringArray(record.submitSelectors, DEFAULT_SUBMIT_SELECTORS),
    submit: typeof record.submit === 'boolean' ? record.submit : defaultSubmit,
  };
}

export function isCredentialFillFrameResult(value: unknown): value is CredentialFillFrameResult {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.ok === 'boolean'
    && typeof record.host === 'string'
    && typeof record.username_filled === 'boolean'
    && typeof record.password_filled === 'boolean'
    && typeof record.submitted === 'boolean';
}

export async function runCredentialFillOnTab(
  tabId: number,
  request: CredentialFillRequest,
): Promise<{ frameId: number; result: CredentialFillFrameResult } | null> {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'MAIN',
    func: credentialFillInFrame,
    args: [request],
  });
  const frameResults = results
    .map((entry) => ({ frameId: entry.frameId, result: entry.result }))
    .filter((entry): entry is { frameId: number; result: CredentialFillFrameResult } =>
      typeof entry.frameId === 'number' && isCredentialFillFrameResult(entry.result),
    );
  return frameResults.find((entry) => entry.result.ok)
    ?? frameResults.find((entry) => entry.result.reason !== 'host_not_allowed')
    ?? frameResults[0]
    ?? null;
}

export type { CredentialFillFrameResult, CredentialFillRequest };
