import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeBrowserTabPlacement, resolveBrowserTabPlacementFromEnv } from './tab-placement.js';

describe('browser tab placement', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to the existing Chrome window', () => {
    vi.stubEnv('OPENCLI_TAB_PLACEMENT', '');

    expect(resolveBrowserTabPlacementFromEnv()).toBe('existing-window');
  });

  it('allows callers to opt back into an OpenCLI-owned container', () => {
    vi.stubEnv('OPENCLI_TAB_PLACEMENT', 'owned-container');

    expect(resolveBrowserTabPlacementFromEnv()).toBe('owned-container');
  });

  it('rejects unsupported placement values', () => {
    expect(() => normalizeBrowserTabPlacement('OPENCLI_TAB_PLACEMENT', 'new-window'))
      .toThrow('owned-container, existing-window');
  });
});
