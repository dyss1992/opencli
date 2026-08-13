import { normalizeCredentialFillRequest, runCredentialFillOnTab, type CredentialFillRequest } from './credential-fill';

type AutofillResponseMessage = {
  type: 'autofill-response';
  requestId: string;
  ok: boolean;
  credential?: unknown;
};

export type PassiveAutofillDependencies = {
  connect: () => Promise<void>;
  getContextId: () => Promise<string>;
  isSocketOpen: () => boolean;
  send: (payload: unknown) => boolean;
};

const CANDIDATE_HOSTS = [
  'login.taobao.com',
  'loginmyseller.taobao.com',
  'havanalogin.taobao.com',
];
const REQUEST_TIMEOUT_MS = 2500;
const ATTEMPT_TTL_MS = 20_000;
const RETRY_DELAYS_MS = [0, 400, 1200, 2500];

function isResponse(value: unknown): value is AutofillResponseMessage {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.type === 'autofill-response'
    && typeof record.requestId === 'string'
    && typeof record.ok === 'boolean';
}

function isCandidateUrl(rawUrl: string | undefined): rawUrl is string {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return CANDIDATE_HOSTS.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
  } catch {
    return false;
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createPassiveAutofill(dependencies: PassiveAutofillDependencies) {
  let requestCounter = 0;
  const pending = new Map<string, {
    resolve: (request: CredentialFillRequest | null) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  const recentAttempts = new Map<string, number>();

  function handleDaemonMessage(value: unknown): boolean {
    if (!isResponse(value)) return false;
    const request = pending.get(value.requestId);
    if (!request) return true;
    clearTimeout(request.timer);
    pending.delete(value.requestId);
    const credential = value.ok ? normalizeCredentialFillRequest(value.credential, false) : null;
    request.resolve(credential ? { ...credential, submit: false } : null);
    return true;
  }

  async function waitForSocket(): Promise<boolean> {
    await dependencies.connect();
    const deadline = Date.now() + REQUEST_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (dependencies.isSocketOpen()) return true;
      await delay(100);
    }
    return dependencies.isSocketOpen();
  }

  async function requestCredential(rawUrl: string): Promise<CredentialFillRequest | null> {
    if (!await waitForSocket()) return null;
    const requestId = `autofill_${Date.now()}_${++requestCounter}`;
    const contextId = await dependencies.getContextId();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        resolve(null);
      }, REQUEST_TIMEOUT_MS);
      pending.set(requestId, { resolve, timer });
      if (dependencies.send({ type: 'autofill-request', requestId, contextId, url: rawUrl })) return;
      clearTimeout(timer);
      pending.delete(requestId);
      resolve(null);
    });
  }

  async function fillTab(tabId: number, rawUrl: string): Promise<void> {
    const credential = await requestCredential(rawUrl);
    if (!credential) return;
    for (const delayMs of RETRY_DELAYS_MS) {
      if (delayMs > 0) await delay(delayMs);
      try {
        const selected = await runCredentialFillOnTab(tabId, credential);
        if (selected?.result.ok) return;
        const reason = selected?.result.reason;
        if (reason && reason !== 'login_inputs_not_found' && reason !== 'host_not_allowed') return;
      } catch {
        return;
      }
    }
  }

  async function triggerForTab(
    tabId: number,
    rawUrl: string | undefined,
    options: { bypassRecent?: boolean } = {},
  ): Promise<void> {
    if (!isCandidateUrl(rawUrl)) return;
    const now = Date.now();
    for (const [key, timestamp] of recentAttempts) {
      if (now - timestamp > ATTEMPT_TTL_MS * 3) recentAttempts.delete(key);
    }
    const key = `${tabId}\n${rawUrl}`;
    if (!options.bypassRecent && now - (recentAttempts.get(key) ?? 0) < ATTEMPT_TTL_MS) return;
    recentAttempts.set(key, now);
    await fillTab(tabId, rawUrl);
  }

  function scheduleForTab(tabId: number, rawUrl: string | undefined): void {
    void triggerForTab(tabId, rawUrl);
  }

  function registerListeners(): void {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' || changeInfo.url) {
        scheduleForTab(tabId, changeInfo.url ?? tab.url);
      }
    });
    chrome.webNavigation?.onCommitted?.addListener(
      (details) => scheduleForTab(details.tabId, details.url),
      { url: CANDIDATE_HOSTS.map((hostEquals) => ({ hostEquals })) },
    );
    chrome.webNavigation?.onCompleted?.addListener(
      (details) => scheduleForTab(details.tabId, details.url),
      { url: CANDIDATE_HOSTS.map((hostEquals) => ({ hostEquals })) },
    );
  }

  async function scanOpenTabs(): Promise<void> {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (typeof tab.id === 'number') scheduleForTab(tab.id, tab.url);
    }
  }

  return { handleDaemonMessage, registerListeners, scanOpenTabs, scheduleForTab, triggerForTab };
}

export const passiveAutofillCandidateHosts = CANDIDATE_HOSTS;
