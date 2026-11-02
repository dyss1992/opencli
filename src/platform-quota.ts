import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadProfileConfig, resolveProfileSelection } from './browser/profile.js';
import { PlatformReadCache, type ReadPolicy } from './platform-read-cache.js';

const root = process.env.DAILY_JOBS_ROOT ?? path.join(os.homedir(), 'Git/daily-jobs');
const cache = new PlatformReadCache(path.join(root, 'runtime/platform-quota/read-cache'));
const aliases: Record<string, string> = {
  'deep-toys': 'deep', 'chabao-xingxing': 'chabao', 'gumo-studio': 'gumo', vnxr339n: 'gumo',
};
const verification = /FAIL_SYS_USER_VALIDATE|MANUAL_VERIFICATION|滑块|验证码|自动请求已暂停/i;
async function helper(action: string, payload: unknown): Promise<Record<string, any>> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.env.PLATFORM_QUOTA_PYTHON ?? '/opt/homebrew/bin/python3',
      [path.join(root, 'scripts/platform_quota_call.py'), action], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', error = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { error += data; });
    child.on('error', reject);
    child.on('close', code => {
      try {
        const row = JSON.parse(output.trim());
        if (code !== 0) reject(Object.assign(new Error(row.error ?? error ?? `quota helper exited ${code}`), { code: row.code }));
        else resolve(row);
      } catch { reject(new Error(error || output || `quota helper exited ${code}`)); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}

export let recoveryChannel: string | undefined;

export async function preparePlatformAccess(
  command: { site: string; name: string; access: string }, args: Record<string, unknown>, profile?: string,
) {
  recoveryChannel = undefined;
  if (!['taobao', 'qn'].includes(command.site)) return null;
  const context = resolveProfileSelection(profile)?.contextId;
  const alias = Object.entries(loadProfileConfig().aliases).find(([name, id]) =>
    id === context && aliases[name])?.[0] ?? profile ?? context ?? '';
  const store = aliases[alias];
  if (!store) throw new Error(`无法确定淘宝店铺的共享额度：${alias || '未指定 profile'}`);
  let inherited: Record<string, any> | undefined;
  try { inherited = JSON.parse(process.env.PLATFORM_QUOTA_CONTEXT ?? 'null') ?? undefined; } catch { /* no parent */ }
  if (inherited && (typeof inherited.id !== 'string' || !inherited.id ||
      !['high', 'low'].includes(inherited.priority) || typeof inherited.purpose !== 'string' || !inherited.purpose)) {
    throw new Error('继承的共享额度上下文无效，未发出平台请求。');
  }
  if (inherited && (inherited.store_key !== store || inherited.platform !== 'taobao')) inherited = undefined;
  const purpose = inherited?.purpose ?? process.env.PLATFORM_QUOTA_PURPOSE ??
    (command.name.startsWith('order') ? 'order' : command.name === 'product-stock' ? 'stock_reduce' :
      command.access === 'write' ? 'publish' : 'align');
  // Writes and all default reads bypass the cache. Only explicitly observational callers opt in.
  const policy: ReadPolicy = { access: command.access, purpose,
    enabled: !inherited && process.env.OPENCLI_READ_CACHE === '1' };
  const cacheable = /^(product-page|product-instock-snapshot|product-sku-matrix)$/.test(command.name) &&
    Object.keys(args).some(key => /^(?:(?:query[_-]?)?(?:item[_-]?id|outer[_-]?id)|id|merchant[_-]?code)$/i.test(key) && args[key]);
  if (!cacheable) policy.enabled = false;
  if (command.access === 'write') { try { cache.invalidate(store); } catch (error) { process.stderr.write(`读取缓存清理失败：${String(error)}\n`); } }
  const key = JSON.stringify([command.site, command.name,
    Object.fromEntries(Object.entries(args).sort(([a], [b]) => a.localeCompare(b)))]);
  const cached = cache.get(store, key, policy);
  // Check local pause and shared paused state even for cache hits, without spending a grant.
  let resuming = false;
  try { await helper('check', { store_key: store, platform: 'taobao', purpose }); }
  catch (error) {
    if ((error as {code?: string}).code !== 'MANUAL_VERIFICATION' || command.access !== 'read' ||
        command.site !== 'qn' || !['order-page', 'product-page'].includes(command.name)) throw error;
    resuming = true;
    recoveryChannel = ['publish', 'order'].includes(purpose) ? purpose : 'read';
  }
  if (cached && !resuming) return { cached, markVerification: () => {}, finish: async (_value?: unknown, _error?: unknown) => {} };
  let verificationSeen = false;
  const grant = resuming ? {} : inherited ?? await helper('acquire', { store_key: store, platform: 'taobao',
    priority: ['order', 'stock_reduce'].includes(purpose) ? 'high' : 'low', purpose });
  return { cached: undefined, markVerification: () => { verificationSeen = true; }, finish: async (value?: unknown, error?: unknown) => {
    const reported = error ?? (value && typeof value === 'object' && 'error' in value ? value : '');
    const text = reported instanceof Error ? `${reported.name} ${reported.message}` : JSON.stringify(reported) ?? '';
    const status = verification.test(text) ? 'verification' : error ? 'failed' : 'ok';
    const failedResult = /"(?:status|状态)"\s*:\s*"(?:error|failed|manual_verification)"|"(?:error|错误)"\s*:\s*"[^"]+"/i.test(JSON.stringify(value) ?? '');
    const channel = recoveryChannel;
    recoveryChannel = undefined;
    if (resuming) {
      const field = command.name === 'order-page' ? '订单编号' : '商品ID';
      const normal = Array.isArray(value) && value.every(row => row && /^\d+$/.test(String(row[field])));
      if (normal && status === 'ok' && !verificationSeen && !failedResult) await helper('resume', { store_key: store, platform: 'taobao', channel })
        .catch(error => { throw new Error(`该店自动请求已暂停：${String(error)}`); });
      else throw new Error(`该店自动请求已暂停；本轮读取未成功：${text || '返回结果无效或验证尚未完成'}`);
      return;
    }
    try { await helper('result', { id: grant.id ?? grant.request_id, status, verification_seen: verificationSeen, ...(error ? { error: text } : {}) }); }
    catch (failure) { process.stderr.write(`额度结果记录失败：${String(failure)}\n`); }
    if (status === 'ok' && !error && !failedResult) {
      try { cache.put(store, key, policy, value); }
      catch (failure) { process.stderr.write(`读取缓存保存失败：${String(failure)}\n`); }
    }
    if (command.access === 'write') { try { cache.invalidate(store); } catch (error) { process.stderr.write(`读取缓存清理失败：${String(error)}\n`); } }
  } };
}
