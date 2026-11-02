import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { recoveryChannel } from './platform-quota.js';
import type { IPage } from './types.js';
import { loadProfileConfig } from './browser/profile.js';
import { sendCommandFull } from './browser/daemon-client.js';

const verification = /\b(?:FAIL_SYS_USER_VALIDATE|MANUAL_VERIFICATION)\b|blocking_verification_required["\s:]+true/i;
const root = path.join(os.homedir(), 'Git/daily-jobs');
const stateRoot = path.join(root, 'runtime/slidex');
const probeScript = `(() => {
  const visible = e => {
    if (e.closest('[hidden], [aria-hidden="true"]')) return false;
    for (let parent=e;parent;parent=parent.parentElement) {
      const s=getComputedStyle(parent);
      if (s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||Number(s.opacity||1)===0) return false;
    }
    const r=e.getBoundingClientRect();
    return r.width>0&&r.height>0;
  };
  const challengeFrame = e => {
    try {
      const u=new URL(e.src,location.href);
      return /(?:^|\\/)(?:punish|captcha|_tmd_|_____tmd_____)(?:\\/|$)/i.test(u.pathname);
    } catch { return false; }
  };
  const nodes=[...document.querySelectorAll('iframe, .nc_scale, [id^="nc_"][id$="_wrapper"], #baxia-punish')];
  const node=nodes.find(e=>visible(e)&&(e.tagName!=='IFRAME'||challengeFrame(e)));
  const key=node ? [performance.timeOrigin,location.href,node.src||node.id||node.className].join('|') : '';
  return {url:location.href,title:document.title,visible:!!node,key};
})()`;

function textOf(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${(value as Error & { code?: string }).code ?? ""} ${value.message}`;
  return typeof value === 'string' ? value : JSON.stringify(value) ?? '';
}
function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function stopped(message: string): Error {
  return Object.assign(new Error(message), { code: 'MANUAL_VERIFICATION', slidexStopped: true });
}

export type SlidexPauseScope = 'publish' | 'order' | 'read';
export function slidexPauseScope(entry: string, access?: string): SlidexPauseScope {
  if (/^(?:qn|taobao)[/.]order(?:[-/.]|$)/.test(entry)) return 'order';
  if (/^(?:qn|taobao)[/.]product-stock$/.test(entry)) return 'read';
  if (/^taobao[/.](?:publish(?:[-/.]|$)|product-(?:instock-edit|presale-edit)$)/.test(entry)) return 'publish';
  return access === 'write' ? 'publish' : 'read';
}

type Context = { profile: string; session: string; entry: string; access: 'read' | 'write'; channel?: SlidexPauseScope; runId?: string; onChallenge?: () => void };
type Probe = { url: string; title?: string; visible: boolean; key: string };
type Attempt = Record<string, unknown> & { passed: boolean; business_read_succeeded: boolean | null };
type Dependencies = {
  directory?: string;
  solve?: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
  notify?: (record: Attempt) => Promise<boolean>;
  retain?: (target: string) => Promise<{ title?: string; url?: string }>;
};

async function python(action: string, request: unknown): Promise<Record<string, unknown>> {
  const executable = action === 'notify' ? '/opt/homebrew/bin/python3' : path.join(os.homedir(), 'Git/slidex/.venv/bin/python');
  const script = path.join(root, 'scripts/slidex_auto_try.py');
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, [script, action], {
      env: { ...process.env, OPENCLI_WINDOW: 'background', OPENCLI_BROWSER_WINDOW_MODE: 'background',
        OPENCLI_TAB_PLACEMENT: 'existing-window', SLIDEX_REMOTE_ENABLED: '0', XY_OUTBOUND_IP_PROBE_URL: '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', code => {
      try {
        const parsed = JSON.parse(output.trim());
        if (code !== 0) reject(new Error(`Slidex helper exited ${code}`));
        else resolve(parsed);
      } catch (error) { reject(error); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(request));
  });
}

/** One guard covers Taobao and QN adapters, including their imported helpers. */
export function createSlidexGuard(raw: IPage, context: Context, deps: Dependencies = {}) {
  const directory = deps.directory ?? stateRoot;
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const aliases = loadProfileConfig().aliases;
  const alias = Object.entries(aliases).find(([name, id]) => id === context.profile &&
    ['deep-toys', 'chabao-xingxing', 'gumo-studio', 'vnxr339n'].includes(name))?.[0] ?? context.profile;
  const store = ({ 'deep-toys': 'Deep Toys', 'chabao-xingxing': '瑞克莫蒂玩玩具',
    'gumo-studio': 'Gumo Studio', vnxr339n: 'Gumo Studio' } as Record<string, string>)[alias] ?? alias;
  const pauseProbe = process.env.OPENCLI_PAUSE_PROBE === '1' && context.entry === 'qn/product-page' && context.access === 'read';
  const pausedRead = pauseProbe || !!recoveryChannel && context.access === 'read' && ['qn/order-page', 'qn/product-page'].includes(context.entry);
  const scope = context.channel ?? slidexPauseScope(context.entry, context.access);
  const pauseFile = path.join(directory, `${digest(store)}.${scope}.paused.json`);
  const legacyPauseFile = path.join(directory, `${digest(store)}.paused.json`);
  function isPaused() {
    if (fs.existsSync(pauseFile)) return true;
    if (!fs.existsSync(legacyPauseFile)) return false;
    try {
      const record = JSON.parse(fs.readFileSync(legacyPauseFile, 'utf8'));
      return record.scope ? record.scope === scope : record.entry ? slidexPauseScope(record.entry, record.access) === scope : true;
    } catch { return true; }
  }
  const retainedFile = path.join(directory, `${digest(store)}.${scope}.retained.json`);
  const attempts: Attempt[] = [];
  let pending: Promise<boolean> | null = null;
  const solve = deps.solve ?? (request => python('solve', request));
  const notify = deps.notify ?? (async record => (await python('notify', record)).sent === true);
  const retain = deps.retain ?? (async (target: string) => {
    const options = { contextId: context.profile, session: context.session, surface: 'adapter' as const };
    const result = await sendCommandFull('tabs', { ...options, op: 'retain', page: target });
    fs.writeFileSync(retainedFile, JSON.stringify({ page: target, profile: context.profile }) + '\n', { mode: 0o600 });
    await sendCommandFull('close-window', options);
    return result.data as { title?: string; url?: string };
  });

  function assertRunning() {
    if (isPaused() && !pausedRead) throw stopped(`${store}自动请求已暂停；请手动拖滑块，下一轮正常读取后自动恢复。`);
  }
  function pause(record: Record<string, unknown>) {
    fs.writeFileSync(pauseFile, JSON.stringify({ ...record, scope, entry: context.entry, access: context.access }) + '\n', { mode: 0o600 });
  }
  function verificationWithoutUi(cause: unknown): Error {
    const code = 'VERIFICATION_WITHOUT_VISIBLE_CHALLENGE';
    fs.appendFileSync(path.join(directory, 'verification-errors.jsonl'), JSON.stringify({
      time: new Date().toISOString(), device: os.hostname(), store, profile: context.profile,
      entry: context.entry, code, retries: 0, shop_paused: false,
    }) + '\n', { mode: 0o600 });
    return Object.assign(new Error(`${store}接口要求验证，但页面没有可见验证界面；本次请求失败，未重试，未暂停店铺。请检查本次接口错误后再处理该条。`),
      { code, cause });
  }
  async function probe(): Promise<Probe | null> {
    if (!raw.getActivePage?.()) return null;
    return await raw.evaluate<Probe>(probeScript);
  }
  async function recover(hint?: Probe | null): Promise<boolean> {
    if (pausedRead) throw stopped(`${store}仍需手动验证，自动请求已暂停，等待下轮读取。`);
    assertRunning();
    if (pending) return pending;
    pending = (async () => {
      const meta = hint ?? await probe().catch(() => null);
      if (!meta?.visible) return false;
      const target = raw.getActivePage?.();
      const challenge = digest(`${target}|${meta?.key || meta?.url || 'unavailable'}`);
      const claim = path.join(directory, `challenge-${challenge}.json`);
      // Retained across CLI processes: a failed or interrupted trial is not replayed.
      try { fs.writeFileSync(claim, context.entry, { flag: 'wx', mode: 0o600 }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        pause({ reason: 'challenge_already_attempted', challenge });
        throw stopped(`${store}这个挑战已尝试过一次；请手动拖滑块，下一轮正常读取后自动恢复。`);
      }
      const record: Attempt = { id: randomUUID(), time: new Date().toISOString(), device: os.hostname(),
        store, profile: context.profile, profile_alias: alias, entry: context.entry, scope,
        page_title: meta?.title ?? '', page_url: meta?.url?.split(/[?#]/)[0] ?? '',
        slidex_version: null, slidex_head: null, return_code: null, passed: false,
        business_read_succeeded: null, challenge };
      attempts.push(record);
      context.onChallenge?.();
      const request = { profile: context.profile, session: context.session,
        page: target, url: meta?.url, surface: 'adapter', run_id: context.runId, entry: context.entry, access: context.access };
      try {
        Object.assign(record, await solve(request));

      } catch (error) { record.error = textOf(error); }
      if (!record.passed) {
        pause(record);
        if (target) {
          try {
            const kept = await retain(target);
            record.page_title = kept.title || record.page_title;
            record.page_url = kept.url?.split(/[?#]/)[0] || record.page_url;
            record.challenge_tab_retained = true;
          } catch (error) { record.challenge_tab_retained = false; record.retain_error = textOf(error); }
        }
        pause(record);
      }
        if (record.human_recording_token && record.challenge_tab_retained) {
          const fd = fs.openSync(path.join(directory, 'human-recordings.log'), 'a', 0o600);
          try {
            const collector = spawn(path.join(os.homedir(), 'Git/slidex/.venv/bin/python'),
              ['-m', 'slidex.integrations.opencli_human', JSON.stringify({ ...request, token: record.human_recording_token })],
              { detached: true, stdio: ['ignore', fd, fd] });
            collector.on('error', error => fs.appendFileSync(path.join(directory, 'human-recordings.log'),
              JSON.stringify({ event: 'human_recording_stopped', profile: context.profile, error: String(error) }) + '\n'));
            collector.unref();
          } finally { fs.closeSync(fd); }
        }
      try { record.notification_sent = await notify(record); }
      catch (error) { record.notification_sent = false; record.notification_error = textOf(error); }
      if (!record.passed) throw stopped(`${store} Slidex未通过，已暂停该店自动请求，请手动拖滑块，下一轮正常读取后自动恢复。`);
      return true;
    })();
    try { return await pending; } finally { pending = null; }
  }

  const unguardedMethods = new Set(['getActivePage', 'setActivePage', 'closeWindow', 'closeTab', 'handleJavaScriptDialog']);
  const page = new Proxy(raw, {
    get(target, key) {
      const member = Reflect.get(target, key);
      if (typeof member !== 'function') return member;
      if (['closeWindow', 'closeTab'].includes(String(key)) && isPaused()) return async () => {};
      if (unguardedMethods.has(String(key))) return member.bind(target);
      return async (...args: unknown[]) => {
        assertRunning();
        let result: unknown;
        try { result = await member.apply(target, args); }
        catch (error) {
          if (!verification.test(textOf(error))) throw error;
          if (!await recover()) throw verificationWithoutUi(error);
          // Never replay a write or an unknown submission outcome.
          if (context.access !== 'read' || key === 'evaluateOnce') throw error;
          return await member.apply(target, args);
        }
        const challenged = verification.test(textOf(result));
        if (challenged) {
          if (!await recover()) throw verificationWithoutUi(result);
          if (context.access !== 'read' || key === 'evaluateOnce') {
            throw stopped('滑块已通过；原操作需要读回核对，未自动重放提交。');
          }
          result = await member.apply(target, args);
          if (verification.test(textOf(result))) {
            if (!(await probe())?.visible) throw verificationWithoutUi(result);
            const record = attempts.at(-1)!;
            record.business_read_succeeded = false;
            pause(record);
            throw stopped(`${store}滑块后业务仍要求验证，已暂停该店自动请求。`);
          }
        }
        if (pausedRead && result && typeof result === 'object' && 'ret' in result &&
            !/^SUCCESS/.test(String((result as {ret: unknown}).ret))) throw stopped(`${store}自动请求已暂停：${textOf(result)}`);
        // Clicks and navigation can reveal a challenge without an error response.
        if (['goto', 'wait', 'click', 'clickAt'].includes(String(key))) {
          const after = await probe();
          if (after?.visible) await recover(after);
        }
        return result;
      };
    },
  });

  return { page, assertRunning,
    async run(invoke: () => Promise<unknown>): Promise<unknown> {
      let success = false;
      try {
        assertRunning();
        if (pauseProbe) {
          const kept = JSON.parse(fs.readFileSync(path.join(directory, `${digest(store)}.${process.env.OPENCLI_PAUSE_PROBE_SCOPE ?? 'publish'}.retained.json`), 'utf8'));
          if (!kept.page) throw stopped('暂停页面已不存在，保留暂停。');
          raw.setActivePage(kept.page);
        }
        if (fs.existsSync(retainedFile) && !pausedRead) {
          const kept = JSON.parse(fs.readFileSync(retainedFile, 'utf8')) as { page: string; profile?: string };
          await sendCommandFull('tabs', { contextId: kept.profile ?? context.profile, session: context.session,
            surface: 'adapter', op: 'close-retained', page: kept.page });
          fs.unlinkSync(retainedFile);
        }
        let result;
        try { result = await invoke(); }
        catch (error) {
          if ((error as { slidexStopped?: boolean }).slidexStopped || !verification.test(textOf(error))) throw error;
          const current = await probe();
          if (!current?.visible) throw verificationWithoutUi(error);
          if (attempts.length) {
            pause(attempts.at(-1)!);
            throw stopped(`${store}滑块后业务仍要求验证，已暂停该店自动请求。`);
          }
          await recover(current);
          if (context.access !== 'read') throw error;
          result = await invoke();
        }
        if (verification.test(textOf(result))) {
          if (!(await probe())?.visible) throw verificationWithoutUi(result);
          if (!attempts.length) await recover();
          pause(attempts.at(-1)!);
          throw stopped('业务读取仍要求验证，已暂停该店自动请求，请手动拖滑块，下一轮正常读取后自动恢复。');
        }
        success = !/"(?:status|状态)"\s*:\s*"(?:error|failed|manual_verification|readback_failed[^"\s]*)"/i.test(textOf(result));
        return result;
      } finally {
        for (const record of attempts) {
          record.business_read_succeeded ??= context.access === 'read' ? record.passed && success : (success ? null : false);
          fs.appendFileSync(path.join(directory, 'attempts.jsonl'), JSON.stringify(record) + '\n', { mode: 0o600 });
        }
      }
    },
  };
}
