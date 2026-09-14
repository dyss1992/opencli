import { afterEach, expect, it, vi } from 'vitest';
import { readBrowserSnapshot } from './browser-readback';

afterEach(() => vi.unstubAllGlobals());

it('reads all normal windows without exposing page contents or mutating tabs', async () => {
  const getAll = vi.fn().mockResolvedValue([
    { id: 7, focused: false, tabs: [
      { id: 2, index: 0, active: true, url: 'https://private.example', title: 'private' },
      { id: 3, index: 1, active: false },
    ] },
  ]);
  vi.stubGlobal('chrome', { windows: { getAll }, runtime: { getManifest: () => ({ version: '1.0.28' }) } });
  const result = await readBrowserSnapshot(new Set([3]));
  expect(getAll).toHaveBeenCalledExactlyOnceWith({ populate: true, windowTypes: ['normal'] });
  expect(result).toEqual({ schema: 'opencli-browser-snapshot-v1', extensionVersion: '1.0.28', windows: [
    { id: 7, focused: false, tabs: [
      { id: 2, index: 0, active: true, backgroundOwned: false },
      { id: 3, index: 1, active: false, backgroundOwned: true },
    ] },
  ] });
});

it('rejects incomplete identifiers instead of fabricating a clean snapshot', async () => {
  vi.stubGlobal('chrome', { windows: { getAll: async () => [{ focused: false, tabs: [] }] }, runtime: { getManifest: () => ({ version: '1.0.28' }) } });
  await expect(readBrowserSnapshot(new Set())).rejects.toThrow('window identifier unavailable');
});
