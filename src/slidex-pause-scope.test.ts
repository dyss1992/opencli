import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { createSlidexGuard, slidexPauseScope } from './slidex-auto-try.js';
import type { IPage } from './types.js';

describe('entry-scoped verification pauses', () => {
  it.each([
    ['taobao/publish', 'write', 'publish'], ['taobao/product-presale-edit', 'write', 'publish'],
    ['qn/order-seller-memo', 'write', 'order'], ['qn/order-pending-short-names', 'write', 'order'],
    ['taobao/order-phone', 'read', 'order'], ['qn/product-stock', 'write', 'read'],
    ['qn/product-report', 'read', 'read'], ['taobao/store-catalog', 'read', 'read'],
    ['taobao/product-price-matrix', 'read', 'read'], ['taobao/product-sku-matrix', 'read', 'read'],
    ['taobao/product-sku-matrix-repair', 'write', 'publish'],
    ['taobao/product-instock-edit', undefined, 'publish'],
  ])('%s belongs to %s scope', (entry, access, scope) => expect(slidexPauseScope(entry, access)).toBe(scope));

  it.each(['publish', 'order', 'read'])('blocks only %s, including legacy markers', scope => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slidex-scope-'));
    const digest = createHash('sha256').update('Deep Toys').digest('hex');
    const entries = { publish: 'taobao/publish', order: 'qn/order-seller-memo', read: 'taobao/store-catalog' };
    try {
      for (const legacy of [false, true]) {
        const marker = path.join(directory, `${digest}${legacy ? '' : '.' + scope}.paused.json`);
        fs.writeFileSync(marker, JSON.stringify({ entry: entries[scope as keyof typeof entries] }));
        for (const [target, entry] of Object.entries(entries)) {
          const guard = createSlidexGuard({} as IPage, { profile: 'deep-toys', session: 'test', entry, access: 'read' }, { directory });
          if (target === scope) expect(() => guard.assertRunning()).toThrow('已暂停');
          else expect(() => guard.assertRunning()).not.toThrow();
        }
        fs.unlinkSync(marker);
      }
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
  it('persists the challenge scope without pausing other entries', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slidex-persist-'));
    const raw = { getActivePage: () => 'target', evaluate: async () => ({ visible: true, key: 'new', url: 'https://example.test' }), wait: async () => {} } as unknown as IPage;
    try {
      const guard = createSlidexGuard(raw, { profile: 'deep-toys', session: 'test', entry: 'taobao/publish', access: 'write' }, {
        directory, solve: async () => ({ passed: false }), notify: async () => true, retain: async () => ({}),
      });
      await expect(guard.run(() => guard.page.wait({ time: 1 }))).rejects.toThrow('已暂停');
      const marker = fs.readdirSync(directory).find(name => name.endsWith('.publish.paused.json'))!;
      expect(JSON.parse(fs.readFileSync(path.join(directory, marker), 'utf8'))).toMatchObject({ scope: 'publish', entry: 'taobao/publish' });
      expect(() => createSlidexGuard(raw, { profile: 'deep-toys', session: 'test', entry: 'qn/order-seller-memo', access: 'write' }, { directory }).assertRunning()).not.toThrow();
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });

});
