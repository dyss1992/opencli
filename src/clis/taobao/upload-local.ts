import * as fs from 'node:fs';
import * as path from 'node:path';

import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

const UPLOAD_URL = 'https://item.upload.taobao.com/sell/ai/category.htm';
const DEFAULT_WAIT_SECONDS = 20;

type ImagePayload = {
  absPath: string;
  name: string;
  mimeType: string;
  base64: string;
};

type ImageInput = {
  absPath: string;
  mode: 'file' | 'directory';
  images: ImagePayload[];
};

type UploadSignals = {
  previewCount: number;
  hasUploading: boolean;
  hasPreviewKeyword: boolean;
  hasFileName: boolean;
  hasSuccessText: boolean;
  hasNextStepButton: boolean;
  uploadedCount: number;
  hasUploadedImageSection: boolean;
  hasModifyButton: boolean;
};

type UploadAttemptResult = {
  ok: boolean;
  method: string;
  detail: string;
  selectedAccept?: string;
  selectedName?: string;
  inputCount?: number;
  selectedCount?: number;
  error?: string;
};

type UploadOutcome = {
  status: 'confirmed' | 'injected';
  detail: string;
  uploadRequestCount: number;
  placeholderRequestCount: number;
  informationConfirmCount: number;
  qualifyQueryCount: number;
};

function toImagePayload(absPath: string): ImagePayload {
  const resolvedPath = path.resolve(absPath);
  if (!fs.existsSync(resolvedPath)) throw new Error(`Image file not found: ${resolvedPath}`);

  const stat = fs.statSync(resolvedPath);
  if (!stat.isFile()) throw new Error(`Path is not a file: ${resolvedPath}`);

  const ext = path.extname(resolvedPath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.heic': 'image/heic',
  };
  const mimeType = mimeMap[ext];
  if (!mimeType) {
    throw new Error(`Unsupported image format "${ext}". Supported: jpg, jpeg, png, gif, webp, bmp, heic`);
  }

  return {
    absPath: resolvedPath,
    name: path.basename(resolvedPath),
    mimeType,
    base64: fs.readFileSync(resolvedPath).toString('base64'),
  };
}

function readImageInput(inputPath: string): ImageInput {
  const absPath = path.resolve(inputPath);
  if (!fs.existsSync(absPath)) throw new Error(`Image path not found: ${absPath}`);

  const stat = fs.statSync(absPath);
  if (stat.isDirectory()) {
    const imageFiles = fs.readdirSync(absPath, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(absPath, entry.name))
      .filter((candidate) => ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic'].includes(path.extname(candidate).toLowerCase()))
      .sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true, sensitivity: 'base' }));

    if (imageFiles.length === 0) {
      throw new Error(`No supported image files found in directory: ${absPath}`);
    }

    return {
      absPath,
      mode: 'directory',
      images: imageFiles.map((candidate) => toImagePayload(candidate)),
    };
  }

  if (!stat.isFile()) throw new Error(`Path is neither a file nor a directory: ${absPath}`);
  return {
    absPath,
    mode: 'file',
    images: [toImagePayload(absPath)],
  };
}

async function ensureTaobaoPage(page: IPage): Promise<string> {
  await page.goto(UPLOAD_URL);
  await page.wait({ time: 3 });

  const currentUrl: string = await page.evaluate('() => location.href');
  if (currentUrl.includes('login.taobao.com')) {
    throw new Error(
      'Redirected to Taobao login. Please open Chrome, log into Taobao seller center, ' +
      'revisit the upload page once, then rerun this command.'
    );
  }
  return currentUrl;
}

async function clickLocalUploadEntry(page: IPage): Promise<{ clicked: boolean; label?: string }> {
  const result = await page.evaluate(`
    (() => {
      const labels = ['从本地上传', '本地上传', '上传图片', '上传商品图', '上传'];
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const nodes = Array.from(document.querySelectorAll('button, a, label, span, div'));
      for (const label of labels) {
        const target = nodes.find((el) => {
          const text = (el.innerText || el.textContent || '').trim();
          return isVisible(el) && text.includes(label);
        });
        if (target) {
          target.click();
          return { clicked: true, label };
        }
      }
      return { clicked: false };
    })()
  `);

  if (result?.clicked) await page.wait({ time: 1 });
  return result ?? { clicked: false };
}

async function measureSignals(page: IPage, fileNames: string[]): Promise<UploadSignals> {
  return page.evaluate(`
    (() => {
      const fileNames = ${JSON.stringify(fileNames)};
      const baseNames = fileNames.map((name) => name.replace(/\\.[^.]+$/, ''));
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const bodyText = document.body?.innerText || '';
      const previewCount = Array.from(document.querySelectorAll('img, [style*="background-image"]'))
        .filter((el) => isVisible(el))
        .length;
      const uploadCardImages = document.querySelectorAll('#sell-field-uploadImage img').length;
      const uploadedTipMatch = bodyText.match(/已上传\\s*(\\d+)\\s*张/);
      const uploadedCount = uploadedTipMatch ? Number(uploadedTipMatch[1]) : uploadCardImages;

      const hasUploading = !!document.querySelector(
        '[class*="upload"][class*="progress"], [class*="uploading"], [class*="loading"], [aria-busy="true"]'
      );
      const hasPreviewKeyword = /预览|已上传|上传成功|重新上传|本地上传/.test(bodyText);
      const hasFileName = fileNames.some((fileName) => bodyText.includes(fileName)) ||
        baseNames.some((baseName) => bodyText.includes(baseName));
      const hasSuccessText = bodyText.includes('上传成功！根据传入的图片');
      const hasNextStepButton = bodyText.includes('确认，下一步');
      const hasUploadedImageSection = !!document.querySelector('#sell-field-uploadImage');
      const hasModifyButton = bodyText.includes('修改');

      return {
        previewCount,
        hasUploading,
        hasPreviewKeyword,
        hasFileName,
        hasSuccessText,
        hasNextStepButton,
        uploadedCount,
        hasUploadedImageSection,
        hasModifyButton,
      };
    })()
  `);
}

async function injectImagesByInput(page: IPage, images: ImagePayload[]): Promise<UploadAttemptResult> {
  const payload = JSON.stringify(images.map((image) => ({
    name: image.name,
    mimeType: image.mimeType,
    base64: image.base64,
  })));

  return page.evaluate(`
    (() => {
      const images = ${payload};
      const preferred = document.querySelector('input[type="file"][name="file"]');
      const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
      if (inputs.length === 0) {
        return { ok: false, method: 'input-change', inputCount: 0, error: 'No file input found on page' };
      }

      const score = (input) => {
        let value = 0;
        const accept = (input.getAttribute('accept') || '').toLowerCase();
        const parentText = (input.parentElement?.innerText || input.closest('label, div')?.innerText || '').toLowerCase();
        const rect = input.getBoundingClientRect();

        if (!input.disabled) value += 2;
        if (accept.includes('image') || accept.includes('.png') || accept.includes('.jpg')) value += 4;
        if (input.multiple) value += 1;
        if (rect.width > 0 || rect.height > 0) value += 1;
        if (/上传|本地|图片|image|photo/.test(parentText)) value += 2;
        return value;
      };

      const input = preferred || inputs
        .map((item) => ({ item, score: score(item) }))
        .sort((a, b) => b.score - a.score)[0]?.item;

      if (!input) {
        return { ok: false, method: 'input-change', inputCount: inputs.length, error: 'No suitable file input found' };
      }

      try {
        const dt = new DataTransfer();
        for (const image of images) {
          const binary = atob(image.base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const blob = new Blob([bytes], { type: image.mimeType });
          const file = new File([blob], image.name, { type: image.mimeType });
          dt.items.add(file);
        }

        Object.defineProperty(input, 'files', {
          configurable: true,
          value: dt.files,
        });
        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

        return {
          ok: true,
          method: 'input-change',
          detail: 'Injected file list onto input[name=file] and dispatched input/change',
          inputCount: inputs.length,
          selectedAccept: input.getAttribute('accept') || '',
          selectedName: input.getAttribute('name') || '',
          selectedCount: dt.files.length,
        };
      } catch (error) {
        return {
          ok: false,
          method: 'input-change',
          inputCount: inputs.length,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })()
  `);
}

async function injectImagesByDrop(page: IPage, images: ImagePayload[]): Promise<UploadAttemptResult> {
  const payload = JSON.stringify(images.map((image) => ({
    name: image.name,
    mimeType: image.mimeType,
    base64: image.base64,
  })));

  return page.evaluate(`
    (() => {
      const images = ${payload};
      const input = document.querySelector('input[type="file"][name="file"]') || document.querySelector('input[type="file"]');
      const dropzone = input?.closest('[role="application"]') || document.querySelector('[role="application"], .next-upload-inner');
      if (!input || !dropzone) {
        return {
          ok: false,
          method: 'drop-event',
          error: 'Missing file input or dropzone container',
        };
      }

      try {
        const dt = new DataTransfer();
        for (const image of images) {
          const binary = atob(image.base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const blob = new Blob([bytes], { type: image.mimeType });
          const file = new File([blob], image.name, { type: image.mimeType });
          dt.items.add(file);
        }

        const eventInit = { bubbles: true, cancelable: true, composed: true, dataTransfer: dt };
        dropzone.dispatchEvent(new DragEvent('dragenter', eventInit));
        dropzone.dispatchEvent(new DragEvent('dragover', eventInit));
        dropzone.dispatchEvent(new DragEvent('drop', eventInit));

        return {
          ok: true,
          method: 'drop-event',
          detail: 'Dispatched dragenter/dragover/drop on the upload dropzone with a DataTransfer file',
          selectedAccept: input.getAttribute('accept') || '',
          selectedName: input.getAttribute('name') || '',
          inputCount: 1,
          selectedCount: dt.files.length,
        };
      } catch (error) {
        return {
          ok: false,
          method: 'drop-event',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })()
  `);
}

async function clickThenInjectImages(page: IPage, images: ImagePayload[]): Promise<UploadAttemptResult> {
  const trigger = await clickLocalUploadEntry(page);
  const result = await injectImagesByInput(page, images);
  return {
    ...result,
    method: 'click-then-input',
    detail: result.ok
      ? `${result.detail}; ${trigger.clicked ? `clicked "${trigger.label}" first` : 'upload button click was not required'}`
      : result.detail,
  };
}

function countNewUploadRequests(requests: unknown[], baselineCount: number): {
  uploadRequestCount: number;
  placeholderRequestCount: number;
  informationConfirmCount: number;
  qualifyQueryCount: number;
} {
  const next = requests.slice(baselineCount).map((item) => {
    const entry = item as { url?: unknown };
    return String(entry?.url ?? '');
  });
  return {
    uploadRequestCount: next.filter((url) => url.includes('stream-upload.taobao.com/api/upload.api')).length,
    placeholderRequestCount: next.filter((url) => url.includes('optType=getImagePlaceholder')).length,
    informationConfirmCount: next.filter((url) => url.includes('optType=informationConfirm')).length,
    qualifyQueryCount: next.filter((url) => url.includes('optType=qualifyQueryAsyncOpt')).length,
  };
}

async function waitForUploadOutcome(
  page: IPage,
  fileNames: string[],
  baseline: UploadSignals,
  baselineNetworkCount: number,
  expectedImageCount: number,
  timeoutSeconds: number,
): Promise<UploadOutcome> {
  let sawUploading = false;

  for (let i = 0; i < timeoutSeconds; i++) {
    const next = await measureSignals(page, fileNames);
    if (next.hasUploading) sawUploading = true;
    const requests = await page.networkRequests(false);
    const requestStats = countNewUploadRequests(Array.isArray(requests) ? requests : [], baselineNetworkCount);

    const previewIncreased = next.previewCount > baseline.previewCount;
    const successByText = next.hasSuccessText && next.hasNextStepButton;
    const successByNetwork = requestStats.uploadRequestCount >= expectedImageCount &&
      requestStats.placeholderRequestCount >= expectedImageCount;
    const successByRecognizedState = next.hasUploadedImageSection &&
      next.hasModifyButton &&
      next.hasNextStepButton &&
      next.uploadedCount >= expectedImageCount;
    if (
      next.hasFileName ||
      successByRecognizedState ||
      previewIncreased ||
      successByText ||
      successByNetwork ||
      (sawUploading && !next.hasUploading && next.hasPreviewKeyword)
    ) {
      return {
        status: 'confirmed',
        detail: next.hasFileName
          ? 'Upload confirmed by filename appearing on the page'
          : successByRecognizedState
            ? 'Upload confirmed by Taobao recognized-item state with uploaded images and next-step button'
          : successByText
            ? 'Upload confirmed by Taobao success text and next-step button appearing'
          : successByNetwork
            ? 'Upload confirmed by Taobao upload.api and getImagePlaceholder requests'
            : previewIncreased
              ? 'Upload confirmed by new preview elements appearing on the page'
              : 'Upload confirmed by upload progress completing and preview markers appearing',
        uploadRequestCount: requestStats.uploadRequestCount,
        placeholderRequestCount: requestStats.placeholderRequestCount,
        informationConfirmCount: requestStats.informationConfirmCount,
        qualifyQueryCount: requestStats.qualifyQueryCount,
      };
    }

    await page.wait({ time: 1 });
  }

  const requests = await page.networkRequests(false);
  const requestStats = countNewUploadRequests(Array.isArray(requests) ? requests : [], baselineNetworkCount);
  return {
    status: 'injected',
    detail: 'Image was injected into the page, but no reliable upload-complete signal was detected within the wait window',
    uploadRequestCount: requestStats.uploadRequestCount,
    placeholderRequestCount: requestStats.placeholderRequestCount,
    informationConfirmCount: requestStats.informationConfirmCount,
    qualifyQueryCount: requestStats.qualifyQueryCount,
  };
}

cli({
  site: 'taobao',
  name: 'upload-local',
  description: '淘宝商品发布实验命令：从本地上传一张或一组图片到 AI 发布页',
  domain: 'item.upload.taobao.com',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  timeoutSeconds: 90,
  args: [
    {
      name: 'image-path',
      type: 'string',
      required: true,
      positional: true,
      help: 'Absolute or relative local image file path, or a directory containing images',
    },
    {
      name: 'wait',
      type: 'int',
      default: 20,
      help: 'Seconds to wait for upload confirmation signals',
    },
  ],
  columns: ['status', 'detail', 'file_count', 'file', 'page_url'],
  func: async (page: IPage | null, kwargs) => {
    if (!page) throw new Error('Browser page required');

    const imagePath = String(kwargs['image-path'] ?? '').trim();
    const waitSeconds = Math.max(1, Number(kwargs.wait ?? DEFAULT_WAIT_SECONDS));
    if (!imagePath) throw new Error('Positional argument <image-path> is required');

    const input = readImageInput(imagePath);
    const images = input.images;
    const pageUrl = await ensureTaobaoPage(page);
    const baseline = await measureSignals(page, images.map((image) => image.name));
    const networkBefore = await page.networkRequests(false);
    const baselineNetworkCount = Array.isArray(networkBefore) ? networkBefore.length : 0;

    const attempts: UploadAttemptResult[] = [];
    let finalOutcome: UploadOutcome | null = null;

    const tryAttempt = async (attempt: () => Promise<UploadAttemptResult>): Promise<boolean> => {
      const result = await attempt();
      attempts.push(result);
      if (!result.ok) return false;
      await page.wait({ time: 2 });
      const outcome = await waitForUploadOutcome(
        page,
        images.map((image) => image.name),
        baseline,
        baselineNetworkCount,
        images.length,
        Math.max(4, waitSeconds),
      );
      if (
        outcome.status === 'confirmed' ||
        outcome.uploadRequestCount > 0 ||
        outcome.placeholderRequestCount > 0 ||
        outcome.informationConfirmCount > 0
      ) {
        finalOutcome = outcome;
        return true;
      }
      return false;
    };

    const success =
      await tryAttempt(() => injectImagesByInput(page, images)) ||
      await tryAttempt(() => injectImagesByDrop(page, images)) ||
      await tryAttempt(() => clickThenInjectImages(page, images));

    if (!success && !finalOutcome) {
      finalOutcome = await waitForUploadOutcome(
        page,
        images.map((image) => image.name),
        baseline,
        baselineNetworkCount,
        images.length,
        2,
      );
    }

    if (!attempts.some((item) => item.ok)) {
      const screenshotPath = '/tmp/taobao_upload_local_debug.png';
      await page.screenshot({ path: screenshotPath });
      const reasons = attempts.map((item) => `${item.method}: ${item.error ?? item.detail}`).join(' | ');
      throw new Error(
        `Image injection failed across all strategies: ${reasons || 'unknown error'}. ` +
        `Debug screenshot: ${screenshotPath}`
      );
    }

    const outcome = finalOutcome ?? {
      status: 'injected' as const,
      detail: 'Upload attempt finished without a reliable success marker',
      uploadRequestCount: 0,
      placeholderRequestCount: 0,
      informationConfirmCount: 0,
      qualifyQueryCount: 0,
    };
    const attemptSummary = attempts
      .map((item) => `${item.method}:${item.ok ? 'ok' : 'fail'}`)
      .join(', ');

    return [{
      status: outcome.status,
      detail:
        `${outcome.detail}; attempts=${attemptSummary}; ` +
        `uploadRequests=${outcome.uploadRequestCount}; placeholderRequests=${outcome.placeholderRequestCount}; ` +
        `informationConfirm=${outcome.informationConfirmCount}; qualifyQuery=${outcome.qualifyQueryCount}`,
      file_count: images.length,
      file: input.absPath,
      page_url: pageUrl,
    }];
  },
});
