const MESSAGE_TYPE = 'autofill-page-ready';
const NOTIFY_DELAYS_MS = [0, 500, 1500];

function notifyBackground(): void {
  try {
    chrome.runtime.sendMessage({ type: MESSAGE_TYPE, url: window.location.href }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // The extension may have reloaded while this content script was alive.
  }
}

for (const delayMs of NOTIFY_DELAYS_MS) {
  window.setTimeout(notifyBackground, delayMs);
}
