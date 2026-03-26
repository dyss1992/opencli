import * as fs from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';

import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { uploadLocalImages } from './common.js';

const DEFAULT_UPLOAD_WAIT_SECONDS = 20;
const DEFAULT_SUCCESS_WAIT_SECONDS = 30;
const HUMANIZED_DELAY_MIN_SECONDS = 1.2;
const HUMANIZED_DELAY_MAX_SECONDS = 3.8;

type PublishInput = {
  imagePath?: string;
  category?: string;
  title?: string;
  brand?: string;
  model?: string;
  age?: string;
  material?: string;
  character?: string;
  workTitle?: string;
  region?: string;
  price?: string;
  stock?: number;
  merchantCode?: string;
  deliveryDays?: number;
  wait?: number;
  submit?: boolean;
};

type PublishState = {
  url: string;
  catId: string | null;
  isAiPage: boolean;
  isPublishPage: boolean;
  isSuccessPage: boolean;
  hasNextButton: boolean;
  hasCategoryBlock: boolean;
  confirmedUploadCount: number;
  categoryPath: string | null;
  selectedShelfMode: string | null;
  itemId: string | null;
  itemUrl: string | null;
};

type CategoryProfile = {
  key: 'plush' | 'figure' | 'homeware';
  label: string;
  catIds: string[];
  pathHints: string[];
  inputHints: string[];
  aiSearchKeyword?: string;
  aiTargetLeaf?: string;
  aiTreePath?: string[];
  materialSelectors: string[];
  characterSelectors: string[];
  workTitleSelectors: string[];
  regionContainerSelector?: string;
  ageContainerSelector?: string;
  defaultAge?: string;
};

async function waitForHumanizedDelay(
  page: IPage,
  minSeconds = HUMANIZED_DELAY_MIN_SECONDS,
  maxSeconds = HUMANIZED_DELAY_MAX_SECONDS,
): Promise<number> {
  const lower = Math.max(0, minSeconds);
  const upper = Math.max(lower, maxSeconds);
  const seconds = Number((lower + Math.random() * (upper - lower)).toFixed(3));
  await page.wait({ time: seconds });
  return seconds;
}

const CATEGORY_PROFILES: CategoryProfile[] = [
  {
    key: 'plush',
    label: '动漫毛绒',
    catIds: ['122676006'],
    pathHints: ['动漫毛绒', '毛绒'],
    inputHints: ['毛绒', 'plush'],
    aiSearchKeyword: '毛绒',
    aiTargetLeaf: '动漫毛绒/抱枕/坐垫',
    aiTreePath: ['模玩/动漫/周边/娃圈三坑/桌游', '卡通/动漫周边', '动漫毛绒/抱枕/坐垫'],
    materialSelectors: ['input[name="p-20021"]'],
    characterSelectors: ['input[name="p-587451596"]'],
    workTitleSelectors: ['#sell-field-p-135924127 input[role="combobox"]'],
    regionContainerSelector: '#sell-field-p-18821503',
  },
  {
    key: 'figure',
    label: '手办',
    catIds: ['50008406'],
    pathHints: ['手办', '手办景品'],
    inputHints: ['手办', 'figure', '景品'],
    aiSearchKeyword: '手办',
    aiTargetLeaf: '手办/手办景品',
    aiTreePath: ['模玩/动漫/周边/娃圈三坑/桌游', '手办/兵人/扭蛋', '手办/手办景品'],
    materialSelectors: [],
    characterSelectors: ['#struct-p-135892197 input[role="combobox"]'],
    workTitleSelectors: ['#sell-field-p-135924127 input[role="combobox"]'],
    regionContainerSelector: '#sell-field-p-18821503',
    ageContainerSelector: '#sell-field-p-20017',
    defaultAge: '14周岁以上',
  },
  {
    key: 'homeware',
    label: '动漫水杯/居家/百货',
    catIds: ['122678005'],
    pathHints: ['动漫水杯/居家/百货', '居家/百货', '水杯'],
    inputHints: ['夜灯', 'night light', '居家', '百货', '水杯'],
    aiSearchKeyword: '水杯',
    aiTargetLeaf: '动漫水杯/居家/百货',
    aiTreePath: ['模玩/动漫/周边/娃圈三坑/桌游', '卡通/动漫周边', '动漫水杯/居家/百货'],
    materialSelectors: [],
    characterSelectors: [],
    workTitleSelectors: [],
    regionContainerSelector: '#sell-field-p-18821503',
  },
];

function normalizeText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeLower(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function snapshotToText(snapshot: unknown): string {
  return typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot);
}

function findSnapshotRefByLabel(snapshot: unknown, label: string): string | null {
  const text = snapshotToText(snapshot);
  const exactTitle = text.match(new RegExp(`\\[(\\d+)\\]<[^\\n>]*title=${escapeRegExp(label)}(?:\\s|/|>)`, 'i'));
  if (exactTitle?.[1]) return exactTitle[1];

  const exactTagText = text.match(new RegExp(`\\[(\\d+)\\]<[^\\n>]*>${escapeRegExp(label)}<`, 'i'));
  if (exactTagText?.[1]) return exactTagText[1];

  return null;
}

function matchesCategoryProfile(state: PublishState, profile: CategoryProfile): boolean {
  const normalizedPath = normalizeLower(state.categoryPath);
  return (state.catId ? profile.catIds.includes(state.catId) : false) ||
    profile.pathHints.some((hint) => normalizedPath.includes(normalizeLower(hint)));
}

function matchCategoryProfileValue(value: unknown): CategoryProfile | null {
  const normalized = normalizeLower(value);
  const raw = normalizeText(value);
  if (!normalized) return null;

  return CATEGORY_PROFILES.find((profile) =>
    normalizeLower(profile.key) === normalized ||
    normalizeLower(profile.label) === normalized ||
    profile.catIds.includes(raw) ||
    profile.pathHints.some((hint) => normalized === normalizeLower(hint) || normalized.includes(normalizeLower(hint))) ||
    profile.inputHints.some((hint) => normalized.includes(normalizeLower(hint)))
  ) ?? null;
}

function detectCategoryProfile(state: PublishState): CategoryProfile {
  const profile = CATEGORY_PROFILES.find((candidate) => matchesCategoryProfile(state, candidate));

  if (profile) return profile;

  throw new Error(
    `Unsupported Taobao category for publish automation. ` +
    `catId=${state.catId ?? 'n/a'}; path=${state.categoryPath ?? 'n/a'}`,
  );
}

function detectDesiredCategoryProfile(input: Pick<PublishInput, 'category' | 'title' | 'model'>): CategoryProfile | null {
  const explicitCategory = matchCategoryProfileValue(input.category);
  if (explicitCategory) return explicitCategory;

  const haystack = [
    normalizeLower(input.title),
    normalizeLower(input.model),
  ].filter(Boolean);

  if (haystack.length === 0) return null;

  return CATEGORY_PROFILES.find((profile) =>
    profile.pathHints.some((hint) => haystack.some((value) => value.includes(normalizeLower(hint)))) ||
    profile.inputHints.some((hint) => haystack.some((value) => value.includes(normalizeLower(hint))))
  ) ?? null;
}

function inferMerchantCode(inputPath: string): string {
  const base = path.basename(path.resolve(inputPath));
  const ext = path.extname(base);
  return ext ? path.basename(base, ext) : base;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function firstDefined(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function toOptionalString(value: unknown): string | undefined {
  if (value == null) return undefined;
  const normalized = String(value).trim();
  return normalized ? normalized : undefined;
}

function toOptionalInt(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) return undefined;
  return Math.floor(normalized);
}

function toOptionalMinimumInt(value: unknown, min: number): number | undefined {
  const normalized = toOptionalInt(value);
  if (normalized == null) return undefined;
  return Math.max(min, normalized);
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return undefined;
}

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  return toOptionalString(firstDefined(record, keys));
}

function pickPositiveInt(record: Record<string, unknown>, keys: string[]): number | undefined {
  return toOptionalInt(firstDefined(record, keys));
}

function pickBoolean(record: Record<string, unknown>, keys: string[]): boolean | undefined {
  return toOptionalBoolean(firstDefined(record, keys));
}

function firstDefinedFromRecords(
  records: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
): unknown {
  for (const record of records) {
    if (!record) continue;
    const value = firstDefined(record, keys);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function pickStringFromRecords(
  records: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
): string | undefined {
  return toOptionalString(firstDefinedFromRecords(records, keys));
}

function pickIntFromRecords(
  records: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
): number | undefined {
  return toOptionalInt(firstDefinedFromRecords(records, keys));
}

function pickMinimumIntFromRecords(
  records: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
  min: number,
): number | undefined {
  return toOptionalMinimumInt(firstDefinedFromRecords(records, keys), min);
}

function pickBooleanFromRecords(
  records: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
): boolean | undefined {
  return toOptionalBoolean(firstDefinedFromRecords(records, keys));
}

function loadPublishInput(specPath: string): PublishInput {
  const absPath = path.resolve(specPath);
  if (!fs.existsSync(absPath)) throw new Error(`Publish spec not found: ${absPath}`);
  if (!fs.statSync(absPath).isFile()) throw new Error(`Publish spec is not a file: ${absPath}`);

  const rawText = fs.readFileSync(absPath, 'utf8');
  const ext = path.extname(absPath).toLowerCase();
  let parsed: unknown;

  try {
    parsed = ext === '.json' ? JSON.parse(rawText) : yaml.load(rawText);
  } catch (error) {
    throw new Error(`Failed to parse publish spec ${absPath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const root = asObject(parsed);
  if (!root) throw new Error(`Publish spec must be an object: ${absPath}`);

  const taobao = asObject(root.taobao);
  const scoped = asObject(taobao?.publish) ?? asObject(root.publish) ?? root;
  const media = asObject(scoped.media);
  const listing = asObject(scoped.listing);
  const attributes = asObject(scoped.attributes);
  const fulfillment = asObject(scoped.fulfillment);
  const inventory = asObject(scoped.inventory);
  const pricing = asObject(scoped.pricing);
  const records = [scoped, media, listing, attributes, fulfillment, inventory, pricing];

  const imagePath = pickStringFromRecords(records, ['image-path', 'image_path', 'imagePath', 'images', 'image']);

  return {
    imagePath: imagePath
      ? (path.isAbsolute(imagePath) ? imagePath : path.resolve(path.dirname(absPath), imagePath))
      : undefined,
    category: pickStringFromRecords(records, ['category', 'category-key', 'category_key', 'categoryKey', 'category-path', 'category_path', 'categoryPath']),
    title: pickStringFromRecords(records, ['title']),
    brand: pickStringFromRecords(records, ['brand']),
    model: pickStringFromRecords(records, ['model']),
    age: pickStringFromRecords(records, ['age', 'age-range', 'age_range', 'ageRange']),
    material: pickStringFromRecords(records, ['material']),
    character: pickStringFromRecords(records, ['character']),
    workTitle: pickStringFromRecords(records, ['work-title', 'work_title', 'workTitle']),
    region: pickStringFromRecords(records, ['region']),
    price: pickStringFromRecords(records, ['price']),
    stock: pickIntFromRecords(records, ['stock']),
    merchantCode: pickStringFromRecords(records, ['merchant-code', 'merchant_code', 'merchantCode']),
    deliveryDays: pickMinimumIntFromRecords(records, ['delivery-days', 'delivery_days', 'deliveryDays'], 1),
    wait: pickMinimumIntFromRecords(records, ['wait', 'wait-seconds', 'wait_seconds', 'waitSeconds'], 1),
    submit: pickBooleanFromRecords(records, ['submit']),
  };
}

async function readPublishState(page: IPage): Promise<PublishState> {
  return page.evaluate(`
    (() => {
      const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const aiNextButton = Array.from(document.querySelectorAll('.ai-category-image-mode-footer button'))
        .find((button) => isVisible(button));

      const pageText = normalize(document.body?.innerText || document.body?.textContent || '');
      const summaryMatches = Array.from(pageText.matchAll(/已上传\\s*(\\d+)\\s*张/g)).map((match) => Number(match[1] || 0));
      const summaryCount = summaryMatches.length > 0 ? Math.max(...summaryMatches) : 0;
      const thumbnailCount = Array.from(document.querySelectorAll('img'))
        .filter((img) => {
          if (!isVisible(img)) return false;
          const src = String(img.currentSrc || img.src || img.getAttribute('src') || '');
          return /_320x320q80_|blob:|data:image\\//i.test(src);
        })
        .length;

      const selectedShelfLabel = (() => {
        const wrappers = Array.from(document.querySelectorAll('#sell-field-startTime .next-radio-wrapper'));
        const selected = wrappers.find((wrapper) => wrapper.getAttribute('aria-checked') === 'true' || wrapper.classList.contains('checked'));
        if (!selected) return null;
        const label = selected.closest('.radio-item')?.querySelector('.item-label');
        return normalize(label?.textContent || '');
      })();

      const currentUrl = String(location.href || '');
      const visibleCategoryPath = Array.from(document.querySelectorAll('#sell-field-category .path-name, .sell-component-category-line .path-name'))
        .find((candidate) => candidate instanceof HTMLElement && isVisible(candidate));
      const hasVisibleCategoryBlock = Array.from(document.querySelectorAll('#sell-field-category, .sell-component-category-line, .switch-cate-btn'))
        .some((candidate) => candidate instanceof HTMLElement && isVisible(candidate));
      let itemId = null;
      try {
        const parsed = new URL(currentUrl, location.origin);
        itemId = parsed.searchParams.get('primaryId');
      } catch (error) {
        const match = currentUrl.match(/[?&]primaryId=(\\d+)/i);
        itemId = match ? match[1] : null;
      }
      const itemLink = Array.from(document.querySelectorAll('a')).find((element) => {
        const href = String(element.getAttribute('href') || '');
        return /item\\.taobao\\.com\\/item\\.htm\\?id=\\d+/i.test(href);
      });

      return {
        url: currentUrl,
        catId: (() => {
          try {
            const parsed = new URL(currentUrl, location.origin);
            return parsed.searchParams.get('catId');
          } catch (error) {
            const match = currentUrl.match(/[?&]catId=(\\d+)/i);
            return match ? match[1] : null;
          }
        })(),
        isAiPage: /\\/sell\\/ai\\/category\\.htm\\b/i.test(currentUrl),
        isPublishPage: /\\/sell\\/v2\\/publish\\.htm\\b/i.test(currentUrl),
        isSuccessPage: /\\/sell\\/v2\\/success\\.htm\\b/i.test(currentUrl),
        hasNextButton: Boolean(aiNextButton),
        hasCategoryBlock: hasVisibleCategoryBlock,
        confirmedUploadCount: Math.max(summaryCount, thumbnailCount),
        categoryPath: normalize(visibleCategoryPath?.textContent || '') || null,
        selectedShelfMode: selectedShelfLabel || null,
        itemId,
        itemUrl: itemLink ? String(itemLink.href || itemLink.getAttribute('href') || '') : null,
      };
    })()
  `);
}

async function clickVisibleAction(page: IPage, labels: string[], dialogOnly = false): Promise<{ clicked: boolean; label?: string }> {
  const result = await page.evaluate(`
    (async () => {
      const labels = ${JSON.stringify(labels)};
      const dialogOnly = ${JSON.stringify(dialogOnly)};
      const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const fireClick = (el) => {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        el.click();
      };
      const roots = dialogOnly
        ? Array.from(document.querySelectorAll('[role="dialog"], .next-dialog, .next-overlay-wrapper, .next-overlay-inner'))
            .filter(isVisible)
        : [document.body];
      const candidates = [];
      for (const root of roots) {
        for (const element of Array.from(root.querySelectorAll('button, a, label, span, div, [role="button"]'))) {
          if (!isVisible(element)) continue;
          const text = normalize(element.innerText || element.textContent || '');
          if (!text) continue;
          const host = element.closest('button, a, label, [role="button"]') || element;
          if (!isVisible(host)) continue;
          candidates.push({ host, text });
        }
      }

      for (const label of labels) {
        const exact = candidates.find((candidate) => candidate.text === label);
        if (exact) {
          fireClick(exact.host);
          return { clicked: true, label };
        }
      }
      for (const label of labels) {
        const fuzzy = candidates.find((candidate) => candidate.text.includes(label));
        if (fuzzy) {
          fireClick(fuzzy.host);
          return { clicked: true, label };
        }
      }
      return { clicked: false };
    })()
  `);
  if (result?.clicked) await waitForHumanizedDelay(page);
  return result;
}

async function clickAiNextButton(page: IPage): Promise<boolean> {
  const result = await page.evaluate(`
    (() => {
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const fireClick = (el) => {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        el.click();
      };
      const button = Array.from(document.querySelectorAll('.ai-category-image-mode-footer button'))
        .find((candidate) => isVisible(candidate));
      if (!button) return { clicked: false };
      fireClick(button);
      return { clicked: true };
    })()
  `);
  if (result?.clicked) await waitForHumanizedDelay(page);
  return Boolean(result?.clicked);
}

async function advanceAiOnce(page: IPage): Promise<PublishState> {
  const clicked = await clickAiNextButton(page);
  if (!clicked) {
    return readPublishState(page);
  }

  await page.wait({ time: 3 });

  let state = await readPublishState(page);
  for (let settle = 0; settle < 5; settle += 1) {
    if (state.isPublishPage) return state;
    if (state.isAiPage && await waitForVisibleSelector(page, ['#sell-field-category .switch-cate-btn', '.switch-cate-btn'], 0.5)) {
      return readPublishState(page);
    }
    if (state.isAiPage && (state.hasCategoryBlock || state.categoryPath)) return state;
    await page.wait({ time: 1 });
    state = await readPublishState(page);
  }
  return state;
}

async function ensureAiCategoryReviewPage(page: IPage): Promise<PublishState> {
  let state = await readPublishState(page);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (state.isPublishPage) return state;
    if (state.isAiPage && await waitForVisibleSelector(page, ['#sell-field-category .switch-cate-btn', '.switch-cate-btn'], 0.5)) {
      return readPublishState(page);
    }
    if (state.isAiPage && (state.hasCategoryBlock || state.categoryPath)) return state;
    if (!state.isAiPage || !state.hasNextButton) break;
    state = await advanceAiOnce(page);
  }
  return state;
}

async function waitForAiCategoryReviewReady(page: IPage, timeoutSeconds: number): Promise<boolean> {
  return waitForVisibleSelector(
    page,
    [
      '#sell-field-category .switch-cate-btn',
      '.switch-cate-btn',
      '#sell-field-category .recommend-cate .path-name[data-cur="pointer"]',
      '#sell-field-category .recommend-cate .path-name',
    ],
    timeoutSeconds,
  );
}

async function waitForAiCategorySearchOpen(page: IPage, timeoutSeconds: number): Promise<boolean> {
  for (let i = 0; i < timeoutSeconds * 2; i += 1) {
    const visible = await page.evaluate(`
      (() => {
        const isVisible = (el) => {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        return Array.from(document.querySelectorAll('.sell-component-general-category-searchwrap input[placeholder*="类目关键词"], .sell-component-general-category-searchwrap input[placeholder*="产品名称"], input[placeholder*="可输入产品名称"]'))
          .some((candidate) => isVisible(candidate));
      })()
    `);
    if (visible) return true;
    await page.wait({ time: 0.5 });
  }
  return false;
}

async function openAiCategorySearch(page: IPage): Promise<void> {
  if (await waitForAiCategorySearchOpen(page, 1)) return;
  if (!await waitForAiCategoryReviewReady(page, 8)) {
    throw new Error('AI category review page did not finish loading before opening 更多类目');
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await page.evaluate(`
      (() => {
        const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
        const isVisible = (el) => {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        const fireClick = (el) => {
          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          el.click();
        };
        const exact = document.querySelector('#sell-field-category .switch-cate-btn, .switch-cate-btn');
        if (exact instanceof HTMLElement && isVisible(exact)) {
          fireClick(exact);
          return { clicked: true, source: 'switch-cate-btn' };
        }
        const fallback = Array.from(document.querySelectorAll('#sell-field-category button, button, a, span, div'))
          .find((candidate) => {
            if (!(candidate instanceof HTMLElement) || !isVisible(candidate)) return false;
            return normalize(candidate.innerText || candidate.textContent || '') === '更多类目';
          });
        if (!(fallback instanceof HTMLElement)) return { clicked: false };
        fireClick(fallback);
        return { clicked: true, source: 'text' };
      })()
    `);

    if (result?.clicked) {
      await waitForHumanizedDelay(page);
      break;
    }
    if (attempt === 4) {
      throw new Error('Could not open the AI category search panel');
    }
    await page.wait({ time: 1 });
  }

  if (!await waitForAiCategorySearchOpen(page, 5)) {
    throw new Error('AI category search panel did not become visible after clicking 更多类目');
  }
}

async function clickVisibleTextInRoots(
  page: IPage,
  labels: string[],
  rootSelectors: string[],
): Promise<{ clicked: boolean; label?: string; text?: string }> {
  return page.evaluate(`
    (() => {
      const labels = ${JSON.stringify(labels)};
      const rootSelectors = ${JSON.stringify(rootSelectors)};
      const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const normalizeLower = (value) => normalize(value).toLowerCase();
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const fireClick = (el) => {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        el.click();
      };
      const roots = rootSelectors
        .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
        .filter((candidate) => isVisible(candidate));
      const candidates = [];
      for (const root of roots) {
        for (const element of Array.from(root.querySelectorAll('button, a, label, span, div, li, em, p, h1, h2, h3, h4'))) {
          if (!(element instanceof HTMLElement) || !isVisible(element)) continue;
          const text = normalize(element.innerText || element.textContent || '');
          if (!text) continue;
          const host = element.closest('button, a, label, [role="button"], li') || element;
          if (!(host instanceof HTMLElement) || !isVisible(host)) continue;
          candidates.push({ host, text });
        }
      }

      for (const label of labels) {
        const exact = candidates.find((candidate) => normalizeLower(candidate.text) === normalizeLower(label));
        if (exact) {
          fireClick(exact.host);
          return { clicked: true, label, text: exact.text };
        }
      }
      for (const label of labels) {
        const fuzzy = candidates.find((candidate) => normalizeLower(candidate.text).includes(normalizeLower(label)));
        if (fuzzy) {
          fireClick(fuzzy.host);
          return { clicked: true, label, text: fuzzy.text };
        }
      }
      return { clicked: false };
    })()
  `);
}

async function waitForAiCategoryProfile(page: IPage, profile: CategoryProfile, timeoutSeconds: number): Promise<PublishState | null> {
  for (let i = 0; i < timeoutSeconds; i += 1) {
    const state = await readPublishState(page);
    if (matchesCategoryProfile(state, profile)) return state;
    await page.wait({ time: 1 });
  }
  return null;
}

async function clickSnapshotRef(page: IPage, ref: string): Promise<void> {
  if (typeof page.nativeClick === 'function') {
    await page.nativeClick(ref);
    await waitForHumanizedDelay(page);
    return;
  }
  await page.click(ref);
  await waitForHumanizedDelay(page);
}

async function clickAiDialogHistoryCategory(page: IPage, label: string): Promise<boolean> {
  const result = await page.evaluate(`
    (() => {
      const label = ${JSON.stringify(label)};
      const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const dialog = document.querySelector('[role="dialog"]');
      if (!(dialog instanceof HTMLElement)) return { ok: false };

      const tabs = Array.from(dialog.querySelectorAll('[role="tab"], li[role="tab"], [role="tab"] div'))
        .map((candidate) => candidate.closest('[role="tab"], li[role="tab"]') || candidate)
        .filter((candidate, index, arr) => arr.indexOf(candidate) === index)
        .filter((candidate) => candidate instanceof HTMLElement && isVisible(candidate));
      const target = tabs.find((candidate) => normalize(candidate.innerText || candidate.textContent || '') === label);
      if (!(target instanceof HTMLElement)) return { ok: false };
      target.click();
      return { ok: true };
    })()
  `);
  if (result?.ok) await waitForHumanizedDelay(page);
  return Boolean(result?.ok);
}

async function clickAiDialogCategoryLeaf(page: IPage, label: string): Promise<boolean> {
  const result = await page.evaluate(`
    (() => {
      const label = ${JSON.stringify(label)};
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const dialog = document.querySelector('[role="dialog"]');
      if (!(dialog instanceof HTMLElement)) return { ok: false };
      const target = Array.from(dialog.querySelectorAll('li[title]'))
        .find((candidate) => candidate.getAttribute('title') === label && isVisible(candidate));
      if (!(target instanceof HTMLElement)) return { ok: false };
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      target.click();
      return { ok: true };
    })()
  `);
  if (result?.ok) await waitForHumanizedDelay(page);
  return Boolean(result?.ok);
}

async function clickAiDialogLastButton(page: IPage): Promise<boolean> {
  const result = await page.evaluate(`
    (() => {
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const dialog = document.querySelector('[role="dialog"]');
      if (!(dialog instanceof HTMLElement)) return { ok: false };
      const buttons = Array.from(dialog.querySelectorAll('button'))
        .filter((candidate) => candidate instanceof HTMLButtonElement && isVisible(candidate) && !candidate.disabled);
      const target = buttons.at(-1);
      if (!(target instanceof HTMLButtonElement)) return { ok: false };
      target.click();
      return { ok: true };
    })()
  `);
  if (result?.ok) await waitForHumanizedDelay(page);
  return Boolean(result?.ok);
}

async function clickAiCategoryDialogSearchButton(page: IPage): Promise<boolean> {
  const result = await page.evaluate(`
    (() => {
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const dialog = document.querySelector('[role="dialog"]');
      if (!(dialog instanceof HTMLElement)) return { ok: false };
      const target = Array.from(dialog.querySelectorAll('button.search-btn, button'))
        .find((candidate) => candidate instanceof HTMLButtonElement && isVisible(candidate) && /搜索/.test(candidate.innerText || candidate.textContent || ''));
      if (!(target instanceof HTMLButtonElement)) return { ok: false };
      target.click();
      return { ok: true };
    })()
  `);
  if (result?.ok) await waitForHumanizedDelay(page);
  return Boolean(result?.ok);
}

async function waitForAiDialogLeafSelected(page: IPage, label: string, timeoutSeconds: number): Promise<boolean> {
  for (let i = 0; i < timeoutSeconds * 2; i += 1) {
    const selected = await page.evaluate(`
      (() => {
        const label = ${JSON.stringify(label)};
        const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
        const dialog = document.querySelector('[role="dialog"]');
        if (!(dialog instanceof HTMLElement)) return false;
        const selectedLeaf = dialog.querySelector('li.category-item.selected[title]');
        if (selectedLeaf && selectedLeaf.getAttribute('title') === label) return true;
        const pathText = normalize(dialog.querySelector('.category-path-wrap .path-list')?.textContent || '');
        return pathText.includes(label);
      })()
    `);
    if (selected) return true;
    await page.wait({ time: 0.5 });
  }
  return false;
}

async function clickAiCategorySelectionConfirm(page: IPage): Promise<boolean> {
  const result = await page.evaluate(`
    (() => {
      const fireClick = (el) => {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        el.click();
      };
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const target = document.querySelector('.sell-component-category-line-cat-dlg-btn button');
      if (!(target instanceof HTMLButtonElement) || !isVisible(target) || target.disabled) return { ok: false };
      fireClick(target);
      return { ok: true };
    })()
  `);
  if (result?.ok) await waitForHumanizedDelay(page);
  return Boolean(result?.ok);
}

async function finalizeAiCategorySelection(page: IPage, profile: CategoryProfile, timeoutSeconds = 10): Promise<PublishState | null> {
  const confirmed = await clickAiCategorySelectionConfirm(page) || await clickAiDialogLastButton(page);
  if (!confirmed) return null;

  await page.wait({ time: 0.8 });

  const switchDialogVisible = await waitForAiCategorySwitchConfirm(page, 2);
  if (switchDialogVisible) {
    if (!await clickAiCategorySwitchConfirm(page)) return null;
  }

  return await waitForAiCategoryProfile(page, profile, timeoutSeconds);
}

async function waitForAiCategorySwitchConfirm(page: IPage, timeoutSeconds: number): Promise<boolean> {
  for (let i = 0; i < timeoutSeconds * 2; i += 1) {
    const visible = await page.evaluate(`
      (() => {
        const isVisible = (el) => {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        const dialog = document.querySelector('[role="alertdialog"]');
        return dialog instanceof HTMLElement && isVisible(dialog);
      })()
    `);
    if (visible) return true;
    await page.wait({ time: 0.5 });
  }
  return false;
}

async function clickAiCategorySwitchConfirm(page: IPage): Promise<boolean> {
  const result = await page.evaluate(`
    (() => {
      const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const dialog = document.querySelector('[role="alertdialog"]');
      if (!(dialog instanceof HTMLElement)) return { ok: false };
      const target = Array.from(dialog.querySelectorAll('button'))
        .find((candidate) =>
          candidate instanceof HTMLButtonElement &&
          isVisible(candidate) &&
          !candidate.disabled &&
          normalize(candidate.innerText || candidate.textContent || '') === '确定'
        );
      if (!(target instanceof HTMLButtonElement)) return { ok: false };
      target.click();
      return { ok: true };
    })()
  `);
  if (result?.ok) await waitForHumanizedDelay(page);
  return Boolean(result?.ok);
}

async function ensureAiCategoryProfile(page: IPage, profile: CategoryProfile): Promise<PublishState> {
  let state = await readPublishState(page);
  if (!state.isAiPage) return state;
  if (matchesCategoryProfile(state, profile)) return state;

  await openAiCategorySearch(page);

  if (profile.aiSearchKeyword && profile.aiTargetLeaf) {
    try {
      await setTextInput(
        page,
        ['[role="dialog"] input[placeholder*="类目搜索"]'],
        profile.aiSearchKeyword,
        '类目搜索',
      );
      if (await clickAiCategoryDialogSearchButton(page)) {
        await page.wait({ time: 2 });

        if (
          await clickAiDialogCategoryLeaf(page, profile.aiTargetLeaf) &&
          await waitForAiDialogLeafSelected(page, profile.aiTargetLeaf, 4) &&
          true
        ) {
          const matched = await finalizeAiCategorySelection(page, profile, 10);
          if (matched) return matched;
        }
      }
    } catch {
      // Fall through to the non-search-based category correction paths below.
    }
  }

  const selectionRoots = [
    '.next-dialog',
    '.next-overlay-inner',
    '.next-overlay-wrapper',
    '.cascade-selection',
    '.category-list',
    '.list-frame',
    '.sell-component-general-category',
    '.sell-component-general-category-searchwrap',
  ];

  if (profile.aiTargetLeaf) {
    if (await clickAiDialogHistoryCategory(page, profile.aiTargetLeaf)) {
      const matched = await finalizeAiCategorySelection(page, profile, 6) ?? await waitForAiCategoryProfile(page, profile, 6);
      if (matched) return matched;
    }

    if (await clickAiDialogCategoryLeaf(page, profile.aiTargetLeaf)) {
      let matched = await finalizeAiCategorySelection(page, profile, 6) ?? await waitForAiCategoryProfile(page, profile, 3);
      if (matched) return matched;

      if (await clickAiDialogLastButton(page)) {
        matched = await waitForAiCategoryProfile(page, profile, 6);
        if (matched) return matched;
      }
    }

    const snapshot = await page.snapshot({ interactive: true, compact: false, maxTextLength: 200 });
    const exactRef = findSnapshotRefByLabel(snapshot, profile.aiTargetLeaf);
    if (exactRef) {
      await clickSnapshotRef(page, exactRef);
      const matched = await finalizeAiCategorySelection(page, profile, 8) ?? await waitForAiCategoryProfile(page, profile, 8);
      if (matched) return matched;
    }

    const clicked = await clickVisibleTextInRoots(
      page,
      [profile.aiTargetLeaf],
      selectionRoots,
    );
    if (clicked.clicked) {
      const matched = await finalizeAiCategorySelection(page, profile, 8) ?? await waitForAiCategoryProfile(page, profile, 8);
      if (matched) return matched;
    }
  }

  if (profile.aiSearchKeyword) {
    await setTextInput(
      page,
      [
        '.sell-component-general-category-searchwrap input[placeholder*="类目关键词"]',
        '.sell-component-general-category-searchwrap input[placeholder*="产品名称"]',
        'input[placeholder*="可输入产品名称"]',
      ],
      profile.aiSearchKeyword,
      '类目搜索',
    );
    const searchClick = await clickVisibleTextInRoots(page, ['搜索'], selectionRoots);
    if (searchClick.clicked) {
      await page.wait({ time: 2 });
      const clicked = await clickVisibleTextInRoots(page, [profile.aiTargetLeaf ?? profile.aiSearchKeyword], selectionRoots);
      if (clicked.clicked) {
        const matched = await finalizeAiCategorySelection(page, profile, 8) ?? await waitForAiCategoryProfile(page, profile, 8);
        if (matched) return matched;
      }
    }
  }

  if (profile.aiTreePath && profile.aiTreePath.length > 0) {
    await clickVisibleTextInRoots(
      page,
      ['选择类目'],
      selectionRoots,
    );
    await page.wait({ time: 1 });

    for (const segment of profile.aiTreePath) {
      const snapshot = await page.snapshot({ interactive: true, compact: false, maxTextLength: 200 });
      const ref = findSnapshotRefByLabel(snapshot, segment);
      if (ref) {
        await clickSnapshotRef(page, ref);
        await page.wait({ time: 1.2 });
        state = await finalizeAiCategorySelection(page, profile, 8) ?? await readPublishState(page);
        if (matchesCategoryProfile(state, profile)) return state;
        continue;
      }

      const clicked = await clickVisibleTextInRoots(
        page,
        [segment],
        selectionRoots.concat('body'),
      );
      if (!clicked.clicked) continue;
      await page.wait({ time: 1.2 });
      state = await finalizeAiCategorySelection(page, profile, 8) ?? await readPublishState(page);
      if (matchesCategoryProfile(state, profile)) return state;
    }
  }

  const finalState = await waitForAiCategoryProfile(page, profile, 8);
  if (finalState) return finalState;

  state = await readPublishState(page);
  throw new Error(
    `Failed to switch the AI page category to ${profile.label}. ` +
    `Current catId=${state.catId ?? 'n/a'}; path=${state.categoryPath ?? 'n/a'}`,
  );
}

async function advanceAiToPublish(page: IPage): Promise<PublishState> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const state = await readPublishState(page);
    if (state.isPublishPage) return state;

    if (!state.isAiPage || !state.hasNextButton) break;

    const clicked = await clickAiNextButton(page);
    if (!clicked) break;

    await page.wait({ time: 3 });

    for (let settle = 0; settle < 5; settle++) {
      const next = await readPublishState(page);
      if (next.isPublishPage) return next;
      if (next.isAiPage && next.hasNextButton) break;
      await page.wait({ time: 1 });
    }
  }

  const finalState = await readPublishState(page);
  if (finalState.isPublishPage) return finalState;

  const screenshotPath = '/tmp/taobao_publish_advance_debug.png';
  await page.screenshot({ path: screenshotPath, fullPage: true });
  throw new Error(
    `Failed to advance from Taobao AI page into publish form. ` +
    `Current URL: ${finalState.url}. Debug screenshot: ${screenshotPath}`,
  );
}

async function setTextInput(
  page: IPage,
  selectors: string[],
  value: string,
  fieldName: string,
  mode: 'text' | 'numeric' = 'text',
): Promise<void> {
  const result = await page.evaluate(`
    (async () => {
      const selectors = ${JSON.stringify(selectors)};
      const nextValue = ${JSON.stringify(value)};
      const mode = ${JSON.stringify(mode)};
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const setValue = (input, value) => {
        const descriptor = input instanceof HTMLTextAreaElement
          ? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
          : Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        descriptor?.set?.call(input, value);
      };
      const buildEventBase = (input) => ({
        target: input,
        currentTarget: input,
        nativeEvent: { target: input },
        bubbles: true,
        cancelable: true,
        defaultPrevented: false,
        eventPhase: 3,
        preventDefault() {},
        stopPropagation() {},
        isDefaultPrevented() { return false; },
        isPropagationStopped() { return false; },
        persist() {},
        timeStamp: Date.now(),
        type: 'change',
      });
      const fireInputSequence = (input, value) => {
        setValue(input, '');
        input.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'deleteContentBackward',
          data: null,
        }));
        input.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          inputType: 'deleteContentBackward',
          data: null,
        }));

        setValue(input, value);
        input.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: value,
        }));
        input.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: value,
        }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      for (const selector of selectors) {
        const candidates = Array.from(document.querySelectorAll(selector));
        const target = candidates.find((candidate) => isVisible(candidate));
        if (!target) continue;

        if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
          continue;
        }

        for (let attempt = 0; attempt < 2; attempt++) {
          target.focus();
          if (typeof target.select === 'function') target.select();
          fireInputSequence(target, nextValue);

          if (mode === 'text') {
            const handlerKey = Object.keys(target).find((key) => key.startsWith('__reactEventHandlers'));
            const handlers = handlerKey ? target[handlerKey] : null;
            const eventBase = buildEventBase(target);
            handlers?.onFocus?.({ ...eventBase, type: 'focus' });
            handlers?.onChange?.({ ...eventBase, type: 'change' });
            handlers?.onBlur?.({ ...eventBase, type: 'blur' });
          }

          target.blur();
          await delay(300);

          if (target.value === nextValue) {
            return {
              ok: true,
              actual: target.value,
              selector,
            };
          }
        }

        return {
          ok: false,
          actual: target.value,
          selector,
        };
      }

      return { ok: false, actual: null, selector: null, error: 'No visible input matched selectors' };
    })()
  `);

  if (!result?.ok) {
    throw new Error(`Failed to set ${fieldName}. Expected "${value}", got "${result?.actual ?? 'n/a'}"`);
  }
  await waitForHumanizedDelay(page);
}

async function waitForVisibleSelector(page: IPage, selectors: string[], timeoutSeconds: number): Promise<boolean> {
  for (let i = 0; i < timeoutSeconds * 2; i += 1) {
    const visible = await page.evaluate(`
      (() => {
        const selectors = ${JSON.stringify(selectors)};
        const isVisible = (el) => {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        return selectors.some((selector) =>
          Array.from(document.querySelectorAll(selector)).some((candidate) => isVisible(candidate))
        );
      })()
    `);
    if (visible) return true;
    await page.wait({ time: 0.5 });
  }
  return false;
}

async function scrollToTop(page: IPage): Promise<void> {
  await page.evaluate(`
    (() => {
      window.scrollTo(0, 0);
      document.documentElement?.scrollTo?.(0, 0);
      document.body?.scrollTo?.(0, 0);
      return true;
    })()
  `);
  await page.wait({ time: 0.8 });
}

async function readComboboxCommittedText(page: IPage, containerSelector: string): Promise<string> {
  return String(await page.evaluate(`
    (() => {
      const container = document.querySelector(${JSON.stringify(containerSelector)});
      if (!(container instanceof HTMLElement)) return '';
      const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const emText = normalize(container.querySelector('.next-select-values em')?.textContent || '');
      const input = container.querySelector('input, textarea');
      const inputValue = input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement
        ? normalize(input.value || '')
        : '';
      const containerText = normalize(container.innerText || container.textContent || '');
      return emText || inputValue || containerText;
    })()
  `));
}

async function isOverlayOptionPopupOpen(page: IPage): Promise<boolean> {
  return Boolean(await page.evaluate(`
    (() => {
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      return Array.from(document.querySelectorAll('.next-overlay-wrapper, .next-overlay-inner'))
        .some((candidate) => isVisible(candidate) && /options-search|options-item/.test(candidate.innerHTML || ''));
    })()
  `));
}

async function openComboboxOverlay(page: IPage, containerSelector: string): Promise<void> {
  const triggerSelectors = [
    `${containerSelector} .next-select`,
    `${containerSelector} .sell-o-select`,
    `${containerSelector} .sell-o-combobox`,
    `${containerSelector} .next-input-control`,
    `${containerSelector} input[role="combobox"]`,
  ];

  if (typeof page.nativeClick === 'function') {
    for (const selector of triggerSelectors) {
      try {
        await page.nativeClick(selector);
        await page.wait({ time: 0.5 });
        if (await isOverlayOptionPopupOpen(page)) return;
      } catch {}
    }
  }

  await page.evaluate(`
    (() => {
      const container = document.querySelector(${JSON.stringify(containerSelector)});
      const trigger = container?.querySelector('.next-select, .sell-o-select, .sell-o-combobox, .next-input-control, input[role="combobox"]');
      if (!(trigger instanceof HTMLElement)) return false;
      trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      trigger.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      trigger.click();
      return true;
    })()
  `);
  await page.wait({ time: 0.4 });

  if (!await isOverlayOptionPopupOpen(page)) {
    throw new Error(`Failed to open the dropdown for ${containerSelector}`);
  }
}

async function typeOverlaySearch(page: IPage, searchText: string): Promise<void> {
  const result = await page.evaluate(`
    (() => {
      const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const input = Array.from(document.querySelectorAll('.next-overlay-wrapper .options-search input, .next-overlay-inner .options-search input'))
        .find((candidate) =>
          isVisible(candidate) &&
          !candidate.disabled &&
          !candidate.readOnly &&
          candidate.type !== 'hidden'
        );
      if (!(input instanceof HTMLInputElement)) return { ok: false, reason: 'overlay-input-not-found' };

      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(input, '');
      input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward', data: null }));
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
      setValue?.call(input, ${JSON.stringify(searchText)});
      input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: ${JSON.stringify(searchText)} }));
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(searchText)} }));
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ${JSON.stringify(searchText.slice(-1) || 'Enter')} }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      return { ok: normalize(input.value) === normalize(${JSON.stringify(searchText)}), actual: input.value };
    })()
  `);

  if (!result?.ok) {
    throw new Error(`Failed to type combobox search text "${searchText}". Current value: "${result?.actual ?? 'n/a'}"`);
  }
  await waitForHumanizedDelay(page, 1.2, 2.8);
}

async function clickOverlayOption(page: IPage, optionText: string): Promise<boolean> {
  const result = await page.evaluate(`
    (() => {
      const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const normalizeLower = (value) => normalize(value).toLowerCase();
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const option = Array.from(document.querySelectorAll('.next-overlay-wrapper .options-item, .next-overlay-inner .options-item, .next-overlay-wrapper [role="option"], .next-overlay-inner [role="option"], .next-overlay-wrapper li, .next-overlay-inner li'))
        .find((candidate) => {
          if (!(candidate instanceof HTMLElement) || !isVisible(candidate)) return false;
          const text = normalize(candidate.getAttribute('title') || candidate.innerText || candidate.textContent || '');
          return normalizeLower(text) === normalizeLower(${JSON.stringify(optionText)}) || normalizeLower(text).includes(normalizeLower(${JSON.stringify(optionText)}));
        });
      if (!(option instanceof HTMLElement)) return { ok: false };
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      option.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      option.click();
      return { ok: true };
    })()
  `);

  if (result?.ok) await waitForHumanizedDelay(page);
  return Boolean(result?.ok);
}

async function selectComboboxOption(
  page: IPage,
  containerSelector: string,
  optionText: string,
  fieldName: string,
  searchText?: string,
  successSelectors: string[] = [],
): Promise<void> {
  const committedBefore = (await readComboboxCommittedText(page, containerSelector)).toLowerCase();
  if (committedBefore.includes(optionText.toLowerCase())) return;

  await openComboboxOverlay(page, containerSelector);

  if (searchText) {
    await typeOverlaySearch(page, searchText);
    await page.wait({ time: 1.5 });
  }

  const clicked = await clickOverlayOption(page, optionText);
  await page.wait({ time: 0.8 });

  const committedAfter = (await readComboboxCommittedText(page, containerSelector)).toLowerCase();
  if (committedAfter.includes(optionText.toLowerCase())) {
    await waitForHumanizedDelay(page);
    return;
  }

  if (successSelectors.length > 0 && await waitForVisibleSelector(page, successSelectors, 2)) {
    return;
  }

  if (!clicked) {
    throw new Error(`Failed to select ${fieldName}="${optionText}". Current value: "${await readComboboxCommittedText(page, containerSelector) || 'n/a'}"`);
  }

  throw new Error(`Failed to confirm ${fieldName}="${optionText}". Current value: "${await readComboboxCommittedText(page, containerSelector) || 'n/a'}"`);
}

async function selectRadioByLabel(page: IPage, containerSelector: string, labelText: string, fieldName: string): Promise<void> {
  const result = await page.evaluate(`
    (async () => {
      const containerSelector = ${JSON.stringify(containerSelector)};
      const labelText = ${JSON.stringify(labelText)};
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const fireClick = (el) => {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        el.click();
      };
      const containerCandidates = Array.from(document.querySelectorAll(containerSelector))
        .filter((candidate) => isVisible(candidate))
        .map((candidate) => {
          const labels = Array.from(candidate.querySelectorAll('.item-label'));
          const target = labels.find((label) => normalize(label.textContent || '') === labelText);
          if (!target) return null;
          let depth = 0;
          let cursor = candidate;
          while (cursor?.parentElement) {
            depth += 1;
            cursor = cursor.parentElement;
          }
          const rect = candidate.getBoundingClientRect();
          return {
            candidate,
            target,
            depth,
            area: rect.width * rect.height,
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.depth - a.depth || a.area - b.area);

      const best = containerCandidates[0];
      if (!best) return { ok: false, reason: 'label-not-found' };

      const container = best.candidate;
      const target = best.target;

      const radioItem = target.closest('.radio-item');
      const radioScope = target.closest('.sell-radio') || radioItem?.parentElement || container;
      const wrapper = radioItem?.querySelector('.next-radio-wrapper');
      const input = radioItem?.querySelector('input');

      for (const node of [input, wrapper, radioItem, target]) {
        if (!node) continue;
        fireClick(node);
        await delay(120);
        const selected = Array.from(radioScope.querySelectorAll('.radio-item')).find((item) => {
          const itemWrapper = item.querySelector('.next-radio-wrapper');
          return itemWrapper?.getAttribute('aria-checked') === 'true' || itemWrapper?.classList.contains('checked');
        });
        const current = normalize(selected?.querySelector('.item-label')?.textContent || '');
        if (current === labelText) {
          return { ok: true, current };
        }
      }

      const selected = Array.from(radioScope.querySelectorAll('.radio-item')).find((item) => {
        const itemWrapper = item.querySelector('.next-radio-wrapper');
        return itemWrapper?.getAttribute('aria-checked') === 'true' || itemWrapper?.classList.contains('checked');
      });
      const current = normalize(selected?.querySelector('.item-label')?.textContent || '');
      return { ok: current === labelText, current };
    })()
  `);

  if (!result?.ok) {
    throw new Error(`Failed to set ${fieldName} to "${labelText}". Current value: "${result?.current ?? 'n/a'}"`);
  }
  await waitForHumanizedDelay(page);
}

async function setDeliveryDays(page: IPage, days: number): Promise<void> {
  await selectRadioByLabel(page, '#sell-field-tmDeliveryTime', '按商品统一设置', '发货方式');
  await selectRadioByLabel(page, '#sell-field-tmDeliveryTime', '大于48小时发货', '发货时间');
  await setTextInput(page, ['#sell-field-tmDeliveryTime input[placeholder*="最长120天"]'], String(days), '发货天数', 'numeric');
}

async function setCategorySpecificFields(
  page: IPage,
  profile: CategoryProfile,
  input: Pick<PublishInput, 'age' | 'material' | 'character' | 'workTitle' | 'region'>,
): Promise<void> {
  if (profile.ageContainerSelector && await waitForVisibleSelector(page, [`${profile.ageContainerSelector} input[role="combobox"]`], 1.5)) {
    const ageValue = input.age || profile.defaultAge;
    if (!ageValue) {
      throw new Error(`Category "${profile.label}" requires 适用年龄`);
    }
    await selectComboboxOption(page, profile.ageContainerSelector, ageValue, '适用年龄', ageValue);
  }

  if (input.material && profile.materialSelectors.length > 0) {
    await setTextInput(page, profile.materialSelectors, input.material, '材质');
  }

  if (input.character && profile.characterSelectors.length > 0) {
    await setTextInput(page, profile.characterSelectors, input.character, '角色名');
  }

  if (input.workTitle && profile.workTitleSelectors.length > 0) {
    await setTextInput(page, profile.workTitleSelectors, input.workTitle, '作品名');
  }

  if (input.region && profile.regionContainerSelector && await waitForVisibleSelector(page, [`${profile.regionContainerSelector} input[role="combobox"]`, `${profile.regionContainerSelector} .next-select`], 1.5)) {
    await selectComboboxOption(page, profile.regionContainerSelector, input.region, '动漫地区');
  }
}

async function ensureVisibleShelfMode(page: IPage, expected: string): Promise<void> {
  const state = await readPublishState(page);
  if (state.selectedShelfMode !== expected) {
    throw new Error(`Shelf mode verification failed. Expected "${expected}", got "${state.selectedShelfMode ?? 'n/a'}"`);
  }
}

async function waitForSuccessPage(page: IPage, timeoutSeconds: number): Promise<PublishState> {
  for (let i = 0; i < timeoutSeconds; i++) {
    const state = await readPublishState(page);
    if (state.isSuccessPage && state.itemId) return state;

    const dialogClick = await clickVisibleAction(page, ['继续发布', '确认提交', '确认', '继续'], true);
    if (dialogClick.clicked) {
      await page.wait({ time: 2 });
      continue;
    }

    await page.wait({ time: 1 });
  }

  const screenshotPath = '/tmp/taobao_publish_submit_debug.png';
  const finalState = await readPublishState(page);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  throw new Error(
    `Submit did not reach Taobao success page within ${timeoutSeconds}s. ` +
    `Current URL: ${finalState.url}. Debug screenshot: ${screenshotPath}`,
  );
}

cli({
  site: 'taobao',
  name: 'publish',
  description: '淘宝商品发布实验命令：支持 YAML/JSON 配置文件，从 AI 上传页进入发布表单并可选提交',
  domain: 'item.upload.taobao.com',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  timeoutSeconds: 300,
  args: [
    {
      name: 'image-path',
      type: 'string',
      required: false,
      positional: true,
      help: '本地图片文件或目录路径；也可放在 --spec 文件里',
    },
    { name: 'spec', required: false, help: '商品配置文件路径，支持 YAML/JSON；命令行参数会覆盖文件中的同名字段' },
    { name: 'category', required: false, help: '目标类目，例如 动漫水杯/居家/百货；会在 AI 上传页纠正类目' },
    { name: 'title', required: false, help: '淘宝宝贝标题' },
    { name: 'brand', required: false, help: '品牌，例如 Youtooz' },
    { name: 'model', required: false, help: '型号，例如 Cartman Plush (9in)' },
    { name: 'age', required: false, help: '适用年龄，例如 14周岁以上' },
    { name: 'material', required: false, help: '材质，例如 毛绒' },
    { name: 'character', required: false, help: '角色名，例如 Cartman' },
    { name: 'work-title', required: false, help: '作品名，例如 南方公园' },
    { name: 'region', required: false, help: '动漫地区，例如 美国' },
    { name: 'price', required: false, help: '一口价，例如 256' },
    { name: 'stock', type: 'int', required: false, help: '总库存，例如 2' },
    { name: 'merchant-code', required: false, help: '商家编码；缺省时取图片目录或文件名' },
    { name: 'delivery-days', type: 'int', help: '发货天数，默认 7' },
    { name: 'wait', type: 'int', help: '上传确认等待秒数，默认 20' },
    { name: 'submit', type: 'bool', default: false, help: '提交宝贝信息；默认只停在提交前' },
  ],
  columns: ['status', 'detail', 'item_id', 'item_url', 'page_url', 'category_path'],
  func: async (page: IPage | null, kwargs) => {
    if (!page) throw new Error('Browser page required');

    await page.newTab();

    const specPath = toOptionalString(kwargs.spec);
    const spec = specPath ? loadPublishInput(specPath) : {};

    const imagePath = toOptionalString(kwargs['image-path']) ?? spec.imagePath ?? '';
    const category = toOptionalString(kwargs.category) ?? spec.category ?? '';
    const title = toOptionalString(kwargs.title) ?? spec.title ?? '';
    const brand = toOptionalString(kwargs.brand) ?? spec.brand ?? '';
    const model = toOptionalString(kwargs.model) ?? spec.model ?? '';
    const age = toOptionalString(kwargs.age) ?? spec.age ?? '';
    const material = toOptionalString(kwargs.material) ?? spec.material ?? '';
    const character = toOptionalString(kwargs.character) ?? spec.character ?? '';
    const workTitle = toOptionalString(kwargs['work-title']) ?? spec.workTitle ?? '';
    const region = toOptionalString(kwargs.region) ?? spec.region ?? '';
    const price = toOptionalString(kwargs.price) ?? spec.price ?? '';
    const stock = toOptionalInt(kwargs.stock) ?? spec.stock ?? 0;
    const merchantCode = toOptionalString(kwargs['merchant-code']) ?? spec.merchantCode ?? (imagePath ? inferMerchantCode(imagePath) : '');
    const deliveryDays = toOptionalMinimumInt(kwargs['delivery-days'], 1) ?? spec.deliveryDays ?? 7;
    const waitSeconds = toOptionalMinimumInt(kwargs.wait, 1) ?? spec.wait ?? DEFAULT_UPLOAD_WAIT_SECONDS;
    const shouldSubmit = toOptionalBoolean(kwargs.submit) ?? spec.submit ?? false;

    if (!imagePath) throw new Error('Either <image-path> or --spec image-path is required');
    if (!title) throw new Error('--title is required');
    if (!brand) throw new Error('--brand is required');
    if (!model) throw new Error('--model is required');
    if (!price) throw new Error('--price is required');
    if (!Number.isFinite(stock) || stock <= 0) throw new Error('--stock must be a positive integer');

    let upload = await uploadLocalImages(page, imagePath, waitSeconds);
    if (upload.outcome.status !== 'confirmed') {
      await page.wait({ time: 2 });
      upload = await uploadLocalImages(page, imagePath, Math.max(waitSeconds, 30));
    }
    if (upload.outcome.status !== 'confirmed') {
      throw new Error(
        `Upload did not reach a confirmed AI state: ${upload.outcome.detail}; ` +
        `attempts=${upload.attemptSummary}; ` +
        `uploadRequests=${upload.outcome.uploadRequestCount}; ` +
        `placeholderRequests=${upload.outcome.placeholderRequestCount}`,
      );
    }

    const desiredProfile = detectDesiredCategoryProfile({ category, title, model });
    let state = await ensureAiCategoryReviewPage(page);
    if (desiredProfile && state.isAiPage && !matchesCategoryProfile(state, desiredProfile)) {
      state = await ensureAiCategoryProfile(page, desiredProfile);
    }

    state = state.isPublishPage ? state : await advanceAiToPublish(page);
    const profile = desiredProfile ?? detectCategoryProfile(state);
    if (desiredProfile && !matchesCategoryProfile(state, desiredProfile)) {
      throw new Error(
        `Category verification failed after leaving the AI page. ` +
        `Expected ${desiredProfile.label}, got ${state.categoryPath ?? state.catId ?? 'n/a'}`,
      );
    }

    await scrollToTop(page);
    if (!await waitForVisibleSelector(page, ['#sell-field-title input', 'input[placeholder*="30个汉字"]', 'input[placeholder*="60字符"]'], 10)) {
      throw new Error('Publish page did not expose the 宝贝标题 input after scrolling to the top');
    }
    await setTextInput(page, ['#sell-field-title input', 'input[placeholder*="30个汉字"]', 'input[placeholder*="60字符"]'], title, '宝贝标题');
    await selectComboboxOption(page, '#sell-field-p-20000', brand, '品牌', brand, ['input[name="p-20000~1"]']);
    if (!await waitForVisibleSelector(page, ['input[name="p-20000~1"]'], 3)) {
      await setTextInput(page, ['#struct-p-20000 input[role="combobox"]'], brand, '品牌');
      if (!await waitForVisibleSelector(page, ['input[name="p-20000~1"]'], 5)) {
        throw new Error(`Brand "${brand}" did not expose the 型号 field`);
      }
    }
    await setTextInput(page, ['input[name="p-20000~1"]'], model, '型号');
    await setCategorySpecificFields(page, profile, { age, material, character, workTitle, region });

    await setTextInput(page, ['#sell-field-price input[maxlength="15"]'], price, '一口价', 'numeric');
    await setTextInput(page, ['#struct-quantity input[maxlength="15"]', '#sell-field-batchInventory-card input[maxlength="15"]'], String(stock), '总库存', 'numeric');
    await setTextInput(page, ['#sell-field-outerId input[maxlength="64"]'], merchantCode, '商家编码');
    await selectRadioByLabel(page, '#sell-field-startTime', '放入仓库', '上架时间');
    await ensureVisibleShelfMode(page, '放入仓库');
    await setDeliveryDays(page, deliveryDays);
    await scrollToTop(page);
    await setTextInput(page, ['#sell-field-title input', 'input[placeholder*="30个汉字"]', 'input[placeholder*="60字符"]'], title, '宝贝标题');
    await setTextInput(page, ['input[name="p-20000~1"]'], model, '型号');
    await setTextInput(page, ['#sell-field-price input[maxlength="15"]'], price, '一口价', 'numeric');
    await setTextInput(page, ['#struct-quantity input[maxlength="15"]'], String(stock), '总库存', 'numeric');
    await setDeliveryDays(page, deliveryDays);

    state = await readPublishState(page);

    if (!shouldSubmit) {
      return [{
        status: 'ready',
        detail:
          `Upload confirmed and publish form filled. attempts=${upload.attemptSummary}; ` +
          `category=${profile.label}; shelfMode=${state.selectedShelfMode ?? 'n/a'}; submit=false`,
        item_id: null,
        item_url: null,
        page_url: state.url,
        category_path: state.categoryPath,
      }];
    }

    if (typeof page.nativeClick === 'function') {
      await page.nativeClick('button[name="button-submit"]');
    } else {
      const submitClick = await clickVisibleAction(page, ['提交宝贝信息']);
      if (!submitClick.clicked) {
        throw new Error('Could not find the "提交宝贝信息" button on the publish page');
      }
    }

    const successState = await waitForSuccessPage(page, DEFAULT_SUCCESS_WAIT_SECONDS);
    return [{
        status: 'submitted',
        detail:
          `Publish submitted successfully. attempts=${upload.attemptSummary}; ` +
          `category=${profile.label}; shelfMode=${successState.selectedShelfMode ?? 'success-page'}; submit=true`,
      item_id: successState.itemId,
      item_url: successState.itemUrl,
      page_url: successState.url,
      category_path: successState.categoryPath,
    }];
  },
});
