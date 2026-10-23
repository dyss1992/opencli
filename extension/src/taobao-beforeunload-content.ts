import { installBeforeUnloadGuard } from './taobao-beforeunload-guard';

installBeforeUnloadGuard({
  EventTarget,
  Window,
  HTMLBodyElement,
  HTMLFrameSetElement,
  window,
});
