export type CredentialFillFrameResult = {
  ok: boolean;
  host: string;
  username_filled: boolean;
  password_filled: boolean;
  submitted: boolean;
  reason?: string;
};

export type CredentialFillRequest = {
  username: string;
  password: string;
  allowedHosts: string[];
  usernameSelectors: string[];
  passwordSelectors: string[];
  activateTextPatterns: string[];
  submitSelectors: string[];
  submit: boolean;
};

/** This function is serialized by chrome.scripting, so every helper stays local. */
export async function credentialFillInFrame(request: CredentialFillRequest): Promise<CredentialFillFrameResult> {
  const host = window.location.hostname;
  const normalizeHost = (value: string) => value.trim().toLowerCase().replace(/^\.+/, '');
  const normalizedHost = normalizeHost(host);
  const allowed = request.allowedHosts.some((entry) => {
    const allowedHost = normalizeHost(entry);
    return allowedHost.length > 0
      && (normalizedHost === allowedHost || normalizedHost.endsWith(`.${allowedHost}`));
  });
  if (!allowed) {
    return {
      ok: false,
      host,
      username_filled: false,
      password_filled: false,
      submitted: false,
      reason: 'host_not_allowed',
    };
  }

  const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const isVisible = (element: Element | null): element is HTMLElement => {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== 'hidden'
      && style.display !== 'none'
      && rect.width > 0
      && rect.height > 0
      && !element.hasAttribute('disabled');
  };
  const queryFirstVisibleInput = (selectors: string[]) => {
    for (const selector of selectors) {
      let elements: Element[] = [];
      try {
        elements = Array.from(document.querySelectorAll(selector));
      } catch {
        continue;
      }
      const found = elements.find((element): element is HTMLInputElement | HTMLTextAreaElement =>
        (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)
          && isVisible(element)
          && !element.readOnly,
      );
      if (found) return found;
    }
    return null;
  };
  const textOf = (element: HTMLElement) => clean([
    element.innerText,
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.getAttribute('placeholder'),
    element instanceof HTMLInputElement ? element.value : '',
  ].filter(Boolean).join(' '));
  const matchesActivationText = (text: string) => request.activateTextPatterns.some((pattern) => {
    try {
      return new RegExp(pattern).test(text);
    } catch {
      return text === pattern || text.includes(pattern);
    }
  });
  const activateLoginMode = () => {
    const candidates = Array.from(document.querySelectorAll('button, a, input, div, span'))
      .filter(isVisible);
    const target = candidates.find((element) => matchesActivationText(textOf(element)));
    if (!target) return false;
    target.click();
    return true;
  };
  const inputEvent = (type: string, value: string) => {
    try {
      return new InputEvent(type, { bubbles: true, cancelable: false, inputType: 'insertText', data: value });
    } catch {
      return new Event(type, { bubbles: true, cancelable: false });
    }
  };
  const dispatchLegacyEvent = (field: HTMLElement, eventName: string) => {
    const event = field.ownerDocument.createEvent('Event');
    event.initEvent(eventName, true, false);
    field.dispatchEvent(event);
  };
  const setValue = async (field: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    field.focus();
    await Promise.resolve();
    field.dispatchEvent(new FocusEvent('focus', { bubbles: false, cancelable: false }));
    field.dispatchEvent(new FocusEvent('focusin', { bubbles: true, cancelable: false }));
    field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: false, key: value }));
    field.dispatchEvent(inputEvent('beforeinput', value));
    field.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, cancelable: false, key: value }));
    const descriptor = Object.getOwnPropertyDescriptor(
      field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value',
    );
    if (descriptor?.set) descriptor.set.call(field, value);
    else field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true, cancelable: false }));
    field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: false, key: value }));
    field.dispatchEvent(new Event('change', { bubbles: true, cancelable: false }));
    dispatchLegacyEvent(field, 'input');
    dispatchLegacyEvent(field, 'change');
  };
  const findSubmitTarget = (
    usernameInput: HTMLInputElement | HTMLTextAreaElement | null,
    passwordInput: HTMLInputElement | HTMLTextAreaElement | null,
  ) => {
    for (const selector of request.submitSelectors) {
      let elements: Element[] = [];
      try {
        elements = Array.from(document.querySelectorAll(selector));
      } catch {
        continue;
      }
      const found = elements.find((element): element is HTMLElement => {
        if (!isVisible(element)) return false;
        return /^(登录|登 录|提交|确认|继续)$/.test(textOf(element))
          || element.getAttribute('type') === 'submit';
      });
      if (found) return found;
    }
    return passwordInput?.form?.querySelector<HTMLElement>('button[type="submit"], input[type="submit"]')
      ?? usernameInput?.form?.querySelector<HTMLElement>('button[type="submit"], input[type="submit"]')
      ?? null;
  };

  let usernameInput = queryFirstVisibleInput(request.usernameSelectors);
  let passwordInput = queryFirstVisibleInput(request.passwordSelectors);
  if ((!usernameInput || !passwordInput) && activateLoginMode()) {
    await delay(500);
    usernameInput = queryFirstVisibleInput(request.usernameSelectors);
    passwordInput = queryFirstVisibleInput(request.passwordSelectors);
  }
  if (!usernameInput || !passwordInput) {
    return {
      ok: false,
      host,
      username_filled: false,
      password_filled: false,
      submitted: false,
      reason: 'login_inputs_not_found',
    };
  }

  await setValue(usernameInput, request.username);
  await setValue(passwordInput, request.password);

  let submitted = false;
  if (request.submit) {
    const submitTarget = findSubmitTarget(usernameInput, passwordInput);
    if (submitTarget) {
      submitTarget.click();
      submitted = true;
    } else if (passwordInput.form && typeof passwordInput.form.requestSubmit === 'function') {
      passwordInput.form.requestSubmit();
      submitted = true;
    }
  }

  return {
    ok: true,
    host,
    username_filled: clean(usernameInput.value).length > 0,
    password_filled: clean(passwordInput.value).length > 0,
    submitted,
    reason: '',
  };
}
