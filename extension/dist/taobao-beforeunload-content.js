const BEFORE_UNLOAD_GUARD_KEY = Symbol.for("opencli.taobao.beforeunload.guard.v1");
function blockOnBeforeUnload(target) {
  if (!target) return false;
  const existing = Object.getOwnPropertyDescriptor(target, "onbeforeunload");
  if (existing && !existing.configurable) return false;
  try {
    Object.defineProperty(target, "onbeforeunload", {
      configurable: true,
      enumerable: existing?.enumerable ?? true,
      get: () => null,
      set: () => void 0
    });
    return true;
  } catch {
    return false;
  }
}
function installBeforeUnloadGuard(realm) {
  const installTarget = realm.window ?? realm.EventTarget?.prototype;
  if (!installTarget || Reflect.get(installTarget, BEFORE_UNLOAD_GUARD_KEY) === true) return false;
  Object.defineProperty(installTarget, BEFORE_UNLOAD_GUARD_KEY, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false
  });
  const eventTargetPrototype = realm.EventTarget?.prototype;
  const originalAddEventListener = eventTargetPrototype ? Reflect.get(eventTargetPrototype, "addEventListener") : void 0;
  if (eventTargetPrototype && typeof originalAddEventListener === "function") {
    Object.defineProperty(eventTargetPrototype, "addEventListener", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: function guardedAddEventListener(...args) {
        if (String(args[0] ?? "").toLowerCase() === "beforeunload") return void 0;
        return Reflect.apply(originalAddEventListener, this, args);
      }
    });
  }
  blockOnBeforeUnload(realm.window);
  blockOnBeforeUnload(realm.Window?.prototype);
  blockOnBeforeUnload(realm.HTMLBodyElement?.prototype);
  blockOnBeforeUnload(realm.HTMLFrameSetElement?.prototype);
  return true;
}

installBeforeUnloadGuard({
  EventTarget,
  Window,
  HTMLBodyElement,
  HTMLFrameSetElement,
  window
});
