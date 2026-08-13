import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isRecord } from '../utils.js';

export type BrowserAutofillKeychain = {
  readonly service: string;
  readonly account: string;
  readonly format: 'json';
};

export type BrowserAutofillEntry = {
  readonly id: string;
  readonly contextId: string;
  readonly allowedHosts: readonly string[];
  readonly matchHosts?: readonly string[];
  readonly usernameSelectors?: readonly string[];
  readonly passwordSelectors?: readonly string[];
  readonly activateTextPatterns?: readonly string[];
  readonly submitSelectors?: readonly string[];
  readonly submit?: boolean;
  readonly keychain: BrowserAutofillKeychain;
};

export type BrowserAutofillConfig = {
  readonly allowedExtensionIds: readonly string[];
  readonly entries: readonly BrowserAutofillEntry[];
};

export type StoredBrowserCredential = {
  readonly username: string;
  readonly password: string;
};

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const CHROME_EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

function cleanChromeExtensionIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => CHROME_EXTENSION_ID_PATTERN.test(entry)))];
}

export function chromeExtensionIdFromOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  const match = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin);
  return match?.[1] ?? null;
}

export function isBrowserAutofillExtensionAllowed(
  extensionId: string | null,
  allowedExtensionIds: readonly string[],
): boolean {
  return extensionId !== null
    && CHROME_EXTENSION_ID_PATTERN.test(extensionId)
    && allowedExtensionIds.includes(extensionId);
}

export function isCredentialBearingAction(action: unknown): boolean {
  return action === 'credential-fill' || action === 'credential-autofill';
}

function parseAutofillEntry(value: unknown): BrowserAutofillEntry | null {
  if (!isRecord(value) || !isRecord(value.keychain)) return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const contextId = typeof value.contextId === 'string' ? value.contextId.trim() : '';
  const service = typeof value.keychain.service === 'string' ? value.keychain.service.trim() : '';
  const account = typeof value.keychain.account === 'string' ? value.keychain.account.trim() : '';
  const allowedHosts = cleanStringArray(value.allowedHosts);
  if (!id || !contextId || !service || !account || allowedHosts.length === 0) return null;
  return {
    id,
    contextId,
    allowedHosts,
    matchHosts: cleanStringArray(value.matchHosts),
    usernameSelectors: cleanStringArray(value.usernameSelectors),
    passwordSelectors: cleanStringArray(value.passwordSelectors),
    activateTextPatterns: cleanStringArray(value.activateTextPatterns),
    submitSelectors: cleanStringArray(value.submitSelectors),
    submit: value.submit === true,
    keychain: { service, account, format: 'json' },
  };
}

function browserAutofillConfigPath(): string {
  const configDir = process.env.OPENCLI_CONFIG_DIR || path.join(os.homedir(), '.opencli');
  return path.join(configDir, 'browser-autofill.json');
}

export function parseBrowserAutofillConfig(value: unknown): BrowserAutofillConfig {
  if (!isRecord(value)) return { allowedExtensionIds: [], entries: [] };
  const entries = Array.isArray(value.entries)
    ? value.entries
      .map(parseAutofillEntry)
      .filter((entry): entry is BrowserAutofillEntry => entry !== null)
    : [];
  return {
    allowedExtensionIds: cleanChromeExtensionIds(value.allowedExtensionIds),
    entries,
  };
}

export function loadBrowserAutofillConfig(): BrowserAutofillConfig {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(browserAutofillConfigPath(), 'utf8'));
    return parseBrowserAutofillConfig(parsed);
  } catch {
    return { allowedExtensionIds: [], entries: [] };
  }
}

export function loadBrowserAutofillEntries(): BrowserAutofillEntry[] {
  return [...loadBrowserAutofillConfig().entries];
}

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/^\.+/, '');
}

function hostMatches(host: string, candidate: string): boolean {
  const normalizedHost = normalizeHost(host);
  const normalizedCandidate = normalizeHost(candidate);
  return normalizedCandidate.length > 0
    && (normalizedHost === normalizedCandidate || normalizedHost.endsWith(`.${normalizedCandidate}`));
}

export function selectBrowserAutofillEntry(
  entries: readonly BrowserAutofillEntry[],
  contextId: string,
  rawUrl: string,
): BrowserAutofillEntry | null {
  let host: string;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    host = url.hostname;
  } catch {
    return null;
  }
  return entries.find((entry) => {
    if (entry.contextId !== contextId) return false;
    const candidates = entry.matchHosts?.length ? entry.matchHosts : entry.allowedHosts;
    return candidates.some((candidate) => hostMatches(host, candidate));
  }) ?? null;
}

export function parseStoredBrowserCredential(raw: string): StoredBrowserCredential | null {
  const text = raw.trim();
  if (!text) return null;
  const payload = /^[0-9a-f]+$/i.test(text) && text.length % 2 === 0
    ? Buffer.from(text, 'hex').toString('utf8').trim()
    : text;
  try {
    const parsed: unknown = JSON.parse(payload);
    if (!isRecord(parsed)) return null;
    const username = typeof parsed.username === 'string' ? parsed.username : '';
    const password = typeof parsed.password === 'string' ? parsed.password : '';
    return username && password ? { username, password } : null;
  } catch {
    return null;
  }
}

export function readBrowserAutofillCredential(entry: BrowserAutofillEntry): StoredBrowserCredential | null {
  if (process.platform !== 'darwin') return null;
  try {
    const result = spawnSync('/usr/bin/security', [
      'find-generic-password',
      '-s', entry.keychain.service,
      '-a', entry.keychain.account,
      '-w',
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.status !== 0 || !result.stdout.trim()) return null;
    return parseStoredBrowserCredential(result.stdout);
  } catch {
    return null;
  }
}
