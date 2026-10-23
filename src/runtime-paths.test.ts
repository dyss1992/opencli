import {describe, expect, it} from 'vitest';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {USER_OPENCLI_DIR, PLUGINS_DIR} from './discovery.js';
import {getLockFilePath, getMonoreposDir} from './plugin.js';

describe('isolated user runtime paths', () => {
  it('keeps discovery, locks and monorepos in the explicit runtime directory', () => {
    const root = process.env.OPENCLI_CONFIG_DIR!;
    expect(root).toBeTruthy();
    expect(root).not.toBe(join(homedir(), '.opencli'));
    expect(USER_OPENCLI_DIR).toBe(root);
    expect(PLUGINS_DIR).toBe(join(root, 'plugins'));
    expect(getLockFilePath()).toBe(join(root, 'plugins.lock.json'));
    expect(getMonoreposDir()).toBe(join(root, 'monorepos'));
  });
});
