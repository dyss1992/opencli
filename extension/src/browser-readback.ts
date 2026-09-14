export class BrowserReadbackError extends Error {}

/** Read only identifiers and visibility; never attach, select, or expose page contents. */
export async function readBrowserSnapshot(backgroundOwnedTabIds: ReadonlySet<number>) {
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  return {
    schema: 'opencli-browser-snapshot-v1' as const,
    extensionVersion: chrome.runtime.getManifest().version,
    windows: windows.map(window => {
      if (window.id === undefined) throw new BrowserReadbackError('window identifier unavailable');
      if (window.tabs === undefined) throw new BrowserReadbackError('window tabs unavailable');
      return {
        id: window.id,
        focused: window.focused,
        tabs: window.tabs.map(tab => {
          if (tab.id === undefined) throw new BrowserReadbackError('tab identifier unavailable');
          return {
            id: tab.id,
            index: tab.index,
            active: tab.active,
            backgroundOwned: backgroundOwnedTabIds.has(tab.id),
          };
        }),
      };
    }),
  };
}
