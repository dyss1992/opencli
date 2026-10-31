import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlatformReadCache, type ReadPolicy } from './platform-read-cache.js';

test('observational reads reuse data; before-write and readback always read current stock', () => {
  const directory = mkdtempSync(join(tmpdir(), 'quota-readback-'));
  try {
    const cache = new PlatformReadCache(directory);
    let platformStock = 3, realReads = 0;
    const read = (purpose: string) => {
      const policy: ReadPolicy = { access: 'read', purpose, enabled: true };
      const hit = cache.get('deep', 'item:1047909657686', policy);
      if (hit) return hit.value;
      realReads++;
      const value = { stock: platformStock };
      cache.put('deep', 'item:1047909657686', policy, value);
      return value;
    };
    assert.deepEqual(read('inventory_report'), { stock: 3 });
    platformStock = 2;
    assert.deepEqual(read('inventory_report'), { stock: 3 });
    assert.equal(realReads, 1);
    assert.deepEqual(read('before_write'), { stock: 2 });
    platformStock = 1;
    assert.deepEqual(read('readback'), { stock: 1 });
    assert.equal(realReads, 3);
    cache.invalidate('deep');
    assert.deepEqual(read('inventory_report'), { stock: 1 });
    assert.equal(realReads, 4);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
