import * as fs from 'node:fs';
import * as path from 'node:path';

import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

const DEFAULT_WAIT_SECONDS = 45;
const DEFAULT_OUTPUT_ROOT = '/tmp/opencli-taobao-manual';

function sanitizeSegment(input: string): string {
  return input
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'capture';
}

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    '-',
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds()),
  ].join('');
}

async function readPageInfo(page: IPage): Promise<{ url: string; title: string }> {
  return page.evaluate(`() => ({
    url: window.location.href,
    title: document.title || ''
  })`);
}

cli({
  site: 'taobao',
  name: 'manual-capture',
  description: '手动操作淘宝页面后抓取 DOM、网络、表单与截图，便于调试发布流程',
  domain: 'item.upload.taobao.com',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  timeoutSeconds: 600,
  args: [
    {
      name: 'label',
      type: 'string',
      required: false,
      positional: true,
      help: 'Optional label for this capture run',
    },
    {
      name: 'wait',
      type: 'int',
      default: 45,
      help: 'Seconds to leave for your manual interaction before capturing artifacts',
    },
    {
      name: 'url',
      type: 'string',
      required: false,
      help: 'Optional URL to open before waiting. If omitted, capture the current active page.',
    },
    {
      name: 'output-dir',
      type: 'string',
      default: '/tmp/opencli-taobao-manual',
      help: 'Directory where capture artifacts will be written',
    },
  ],
  columns: ['status', 'detail', 'capture_dir', 'page_url', 'new_requests'],
  func: async (page: IPage | null, kwargs) => {
    if (!page) throw new Error('Browser page required');

    const waitSeconds = Math.max(1, Number(kwargs.wait ?? DEFAULT_WAIT_SECONDS));
    const baseLabel = sanitizeSegment(String(kwargs.label ?? 'manual'));
    const outputRoot = path.resolve(String(kwargs['output-dir'] ?? DEFAULT_OUTPUT_ROOT));
    const captureDir = path.join(outputRoot, `${nowStamp()}-${baseLabel}`);
    const targetUrl = String(kwargs.url ?? '').trim();

    fs.mkdirSync(captureDir, { recursive: true });

    if (targetUrl) {
      await page.goto(targetUrl);
      await page.wait({ time: 3 });
    }

    const beforeInfo = await readPageInfo(page);
    const baselineNetworkRaw = await page.networkRequests(false);
    const baselineConsoleRaw = await page.consoleMessages('info');
    const baselineNetwork = Array.isArray(baselineNetworkRaw) ? baselineNetworkRaw : [];
    const baselineConsole = Array.isArray(baselineConsoleRaw) ? baselineConsoleRaw : [];

    // Pause here so the user can manually interact with the real page.
    await page.wait({ time: waitSeconds });

    const afterInfo = await readPageInfo(page);
    const html = await page.evaluate('document.documentElement.outerHTML');
    const snapshot = await page.snapshot({ interactive: true, compact: false });
    const formState = await page.getFormState();
    const afterNetworkRaw = await page.networkRequests(false);
    const afterConsoleRaw = await page.consoleMessages('info');
    const afterNetwork = Array.isArray(afterNetworkRaw) ? afterNetworkRaw : [];
    const afterConsole = Array.isArray(afterConsoleRaw) ? afterConsoleRaw : [];
    const newRequests = afterNetwork.slice(baselineNetwork.length);
    const newConsole = afterConsole.slice(baselineConsole.length);

    const metaPath = path.join(captureDir, 'meta.json');
    const htmlPath = path.join(captureDir, 'page.html');
    const snapshotPath = path.join(captureDir, 'snapshot.json');
    const formStatePath = path.join(captureDir, 'form-state.json');
    const networkPath = path.join(captureDir, 'network-all.json');
    const networkDeltaPath = path.join(captureDir, 'network-new.json');
    const consolePath = path.join(captureDir, 'console-all.json');
    const consoleDeltaPath = path.join(captureDir, 'console-new.json');
    const screenshotPath = path.join(captureDir, 'page.png');

    fs.writeFileSync(metaPath, JSON.stringify({
      label: baseLabel,
      waited_seconds: waitSeconds,
      started_from: beforeInfo,
      captured_at: new Date().toISOString(),
      captured_page: afterInfo,
    }, null, 2));
    fs.writeFileSync(htmlPath, typeof html === 'string' ? html : String(html));
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
    fs.writeFileSync(formStatePath, JSON.stringify(formState, null, 2));
    fs.writeFileSync(networkPath, JSON.stringify(afterNetwork, null, 2));
    fs.writeFileSync(networkDeltaPath, JSON.stringify(newRequests, null, 2));
    fs.writeFileSync(consolePath, JSON.stringify(afterConsole, null, 2));
    fs.writeFileSync(consoleDeltaPath, JSON.stringify(newConsole, null, 2));
    await page.screenshot({ path: screenshotPath, fullPage: true });

    return [{
      status: 'captured',
      detail:
        `Artifacts saved after waiting ${waitSeconds}s for manual interaction. ` +
        `Files: meta.json, page.html, snapshot.json, form-state.json, network-new.json, console-new.json, page.png`,
      capture_dir: captureDir,
      page_url: afterInfo.url,
      new_requests: newRequests.length,
    }];
  },
});
