import { describe, expect, it, vi } from 'vitest';

import { installBeforeUnloadGuard } from './taobao-beforeunload-guard';

class FakeEventTarget {
  private readonly listeners = new Map<string, Array<{ listener: () => void; options: unknown }>>();

  addEventListener(type: string, listener: () => void, options?: unknown): void {
    const entries = this.listeners.get(type) ?? [];
    entries.push({ listener, options });
    this.listeners.set(type, entries);
  }

  dispatch(type: string): void {
    for (const entry of this.listeners.get(type) ?? []) entry.listener();
  }

  optionsFor(type: string): unknown[] {
    return (this.listeners.get(type) ?? []).map((entry) => entry.options);
  }
}

class FakeWindow extends FakeEventTarget {}
class FakeBody extends FakeEventTarget {}
class FakeFrameSet extends FakeEventTarget {}

function createRealm() {
  return {
    EventTarget: FakeEventTarget,
    Window: FakeWindow,
    HTMLBodyElement: FakeBody,
    HTMLFrameSetElement: FakeFrameSet,
    window: new FakeWindow(),
  };
}

describe('Taobao beforeunload guard', () => {
  it('drops beforeunload listeners while preserving ordinary listener options', () => {
    const realm = createRealm();
    installBeforeUnloadGuard(realm);

    const target = new realm.EventTarget();
    const unloadListener = vi.fn();
    const clickListener = vi.fn();
    const clickOptions = { capture: true, once: true };

    target.addEventListener('beforeunload', unloadListener, { capture: true });
    target.addEventListener('BeFoReUnLoAd', unloadListener);
    target.addEventListener('click', clickListener, clickOptions);
    target.dispatch('beforeunload');
    target.dispatch('click');

    expect(unloadListener).not.toHaveBeenCalled();
    expect(clickListener).toHaveBeenCalledTimes(1);
    expect(target.optionsFor('click')).toEqual([clickOptions]);
  });

  it('ignores onbeforeunload property assignments on the window and handler prototypes', () => {
    const realm = createRealm();
    installBeforeUnloadGuard(realm);

    const handler = vi.fn();
    Reflect.set(realm.window, 'onbeforeunload', handler);
    const body = new realm.HTMLBodyElement();
    Reflect.set(body, 'onbeforeunload', handler);
    const frameSet = new realm.HTMLFrameSetElement();
    Reflect.set(frameSet, 'onbeforeunload', handler);

    expect(Reflect.get(realm.window, 'onbeforeunload')).toBeNull();
    expect(Reflect.get(body, 'onbeforeunload')).toBeNull();
    expect(Reflect.get(frameSet, 'onbeforeunload')).toBeNull();
  });

  it('is idempotent and does not wrap EventTarget twice', () => {
    const realm = createRealm();
    expect(installBeforeUnloadGuard(realm)).toBe(true);
    const installed = realm.EventTarget.prototype.addEventListener;

    expect(installBeforeUnloadGuard(realm)).toBe(false);
    expect(realm.EventTarget.prototype.addEventListener).toBe(installed);
  });
});
