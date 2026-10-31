import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

export type ReadPolicy = { access: string; purpose: string; enabled: boolean };
export function cacheAllowed(policy: ReadPolicy): boolean {
  return policy.enabled && policy.access === 'read' &&
    ['inventory_report', 'dashboard_read', 'catalog_observe'].includes(policy.purpose);
}
export class PlatformReadCache {
  constructor(private directory: string, private clock = Date.now) {}
  private file(store: string, key: string) {
    return path.join(this.directory, createHash('sha256').update(store).digest('hex'),
      createHash('sha256').update(key).digest('hex') + '.json');
  }
  get(store: string, key: string, policy: ReadPolicy): { value: unknown } | undefined {
    if (!cacheAllowed(policy)) return;
    try {
      const row = JSON.parse(fs.readFileSync(this.file(store, key), 'utf8'));
      if (this.clock() - row.at < 180_000 && this.clock() >= row.at) return { value: row.value };
    } catch { /* A missing or invalid cache is a real read. */ }
  }
  put(store: string, key: string, policy: ReadPolicy, value: unknown) {
    if (!cacheAllowed(policy)) return;
    const file = this.file(store, key);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ at: this.clock(), value }), { mode: 0o600 });
    fs.renameSync(temp, file);
  }
  invalidate(store: string) { fs.rmSync(path.dirname(this.file(store, '')), { recursive: true, force: true }); }
}
