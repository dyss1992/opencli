import { CliError } from '../../errors.js';

const YOUTOOZ_BASE_URL = 'https://youtooz.com';
const YOUTOOZ_360_BASE_URL = 'https://main-site-product-360.youtooz.com/';

export interface YoutoozVariant {
  id?: number;
  title?: string | null;
  sku?: string | null;
  barcode?: string | null;
  available?: boolean;
  price?: number;
  compare_at_price?: number | null;
}

export interface YoutoozProduct {
  id?: number;
  title?: string;
  handle?: string;
  description?: string;
  published_at?: string;
  created_at?: string;
  vendor?: string;
  type?: string;
  tags?: string[];
  price?: number;
  compare_at_price?: number | null;
  available?: boolean;
  variants?: YoutoozVariant[];
  images?: string[];
  featured_image?: string;
  url?: string;
}

export interface Youtooz360Gallery {
  source: string;
  resolvedSource: string;
  preview: string;
  frameCount: number;
  frames: string[];
}

export interface YoutoozProductBundle {
  handle: string;
  width: number;
  product: YoutoozProduct;
  primaryVariant: YoutoozVariant | null;
  productUrl: string;
  descriptionText: string;
  imageUrls: string[];
  sizedImageUrls: string[];
  gallery360: Youtooz360Gallery | null;
}

export function normalizeProductHandle(raw: string): string {
  let value = String(raw ?? '').trim();
  if (!value) return '';

  if (/^https?:\/\//i.test(value) || value.startsWith('//')) {
    try {
      const url = new URL(value.startsWith('//') ? `https:${value}` : value);
      const match = url.pathname.match(/^\/products\/([^/?#]+)/i);
      value = match?.[1] ?? url.pathname;
    } catch {
      // Fall through to string-based normalization below.
    }
  }

  value = value
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/^products\//i, '')
    .replace(/\.(?:js|json)$/i, '');

  try {
    value = decodeURIComponent(value);
  } catch {
    // Keep raw value if it isn't valid URL-encoding.
  }

  return value;
}

export function toAbsoluteUrl(raw: string): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';

  try {
    return new URL(value, YOUTOOZ_BASE_URL).toString();
  } catch {
    return value;
  }
}

export function toSizedShopifyImageUrl(raw: string, width: number): string {
  const absolute = toAbsoluteUrl(raw);
  if (!absolute) return '';

  try {
    const url = new URL(absolute);
    url.searchParams.set('width', String(width));
    return url.toString();
  } catch {
    return absolute;
  }
}

export function htmlToText(html: string): string {
  const input = String(html ?? '').trim();
  if (!input) return '';

  const text = input
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|h1|h2|h3|h4|h5|h6|li)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n+/g, ' | ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  return text.replace(/(?:\s*\|\s*)+$/g, '').trim();
}

export function formatMoneyCents(cents: number | null | undefined): string {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return '';
  return (cents / 100).toFixed(2);
}

export function normalizeImageWidth(raw: unknown, fallback: number = 1500): number {
  const width = Number(raw);
  if (!Number.isFinite(width)) return fallback;
  return Math.max(100, Math.min(Math.round(width), 4000));
}

export function dedupeStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = String(raw ?? '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export async function fetchProduct(handle: string): Promise<YoutoozProduct> {
  const normalizedHandle = normalizeProductHandle(handle);
  if (!normalizedHandle) {
    throw new CliError('INVALID_INPUT', 'Product URL or handle is required', 'Pass a Youtooz product URL or handle');
  }

  const response = await fetch(`${YOUTOOZ_BASE_URL}/products/${encodeURIComponent(normalizedHandle)}.js`, {
    headers: {
      Accept: 'application/json, text/javascript',
      'User-Agent': 'opencli',
    },
  });

  if (response.status === 404) {
    throw new CliError('NOT_FOUND', `Product ${normalizedHandle} not found`, 'Check the Youtooz product URL or handle');
  }

  if (!response.ok) {
    throw new CliError('FETCH_ERROR', `Youtooz product HTTP ${response.status}`, 'Try again later');
  }

  const product = await response.json() as YoutoozProduct;
  if (!product || typeof product !== 'object' || !product.id) {
    throw new CliError('FETCH_ERROR', 'Unexpected Youtooz product response', 'Try again later');
  }

  return product;
}

export async function fetchProductHtml(handle: string): Promise<string> {
  const normalizedHandle = normalizeProductHandle(handle);
  if (!normalizedHandle) {
    throw new CliError('INVALID_INPUT', 'Product URL or handle is required', 'Pass a Youtooz product URL or handle');
  }

  const response = await fetch(`${YOUTOOZ_BASE_URL}/products/${encodeURIComponent(normalizedHandle)}`, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'opencli',
    },
  });

  if (response.status === 404) {
    throw new CliError('NOT_FOUND', `Product ${normalizedHandle} not found`, 'Check the Youtooz product URL or handle');
  }

  if (!response.ok) {
    throw new CliError('FETCH_ERROR', `Youtooz product page HTTP ${response.status}`, 'Try again later');
  }

  return response.text();
}

export function decodeHtmlAttribute(value: string): string {
  return String(value ?? '')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

export function resolveYoutooz360Source(raw: string): string {
  let value = decodeHtmlAttribute(raw).trim();
  if (value.startsWith('//')) value = `https:${value}`;
  if (!value) return '';

  if (value.startsWith(YOUTOOZ_360_BASE_URL)) return value;

  if (!value.startsWith('https://cdn.youtooz.com/')) {
    return value;
  }

  const path = value
    .replace(/^https:\/\/cdn\.youtooz\.com\/+/i, '')
    .replace(/^360\//i, 'prod/')
    .replace(/^360-staging\//i, 'staging/')
    .replace('/v1/{', '/{')
    .replace('/v1/0', '/0')
    .replace(/\/v1\/(\d)/g, '/$1');

  return `${YOUTOOZ_360_BASE_URL}${path.replace(/^\/+/, '')}`;
}

export function expandFramePattern(raw: string): string[] {
  const value = String(raw ?? '')
    .trim()
    .replace(/%7B/ig, '{')
    .replace(/%7D/ig, '}');
  if (!value) return [];

  const match = value.match(/\{(\d+)\.\.(\d+)\}/);
  if (!match) return [value];

  const full = match[0];
  const startRaw = match[1];
  const endRaw = match[2];
  const start = parseInt(startRaw, 10);
  const end = parseInt(endRaw, 10);
  if (Number.isNaN(start) || Number.isNaN(end)) return [value];

  const step = start <= end ? 1 : -1;
  const width = Math.max(startRaw.length, endRaw.length);
  const frames: string[] = [];
  for (let i = start; step > 0 ? i <= end : i >= end; i += step) {
    const token = String(i).padStart(width, '0');
    frames.push(value.replace(full, token));
  }
  return frames;
}

export function extract360Gallery(html: string): Youtooz360Gallery | null {
  const input = String(html ?? '');
  if (!input) return null;

  const blockMatch = input.match(/data-gallery-preview="custom:360"[\s\S]{0,600}?data-gallery-source="([^"]+)"/i);
  const source = decodeHtmlAttribute(blockMatch?.[1] ?? '');
  if (!source) return null;

  const resolvedSource = resolveYoutooz360Source(source);
  const frames = expandFramePattern(resolvedSource);
  const preview = frames[0] ?? '';

  return {
    source,
    resolvedSource,
    preview,
    frameCount: frames.length,
    frames,
  };
}

export function pickPrimaryVariant(product: YoutoozProduct): YoutoozVariant | null {
  return product.variants?.find((variant) => variant?.available) ?? product.variants?.[0] ?? null;
}

export async function fetchProductBundle(
  target: string,
  opts: { width?: number; includeHtml?: boolean } = {},
): Promise<YoutoozProductBundle> {
  const handle = normalizeProductHandle(target);
  if (!handle) {
    throw new CliError('INVALID_INPUT', 'Product URL or handle is required', 'Pass a Youtooz product URL or handle');
  }

  const width = normalizeImageWidth(opts.width, 1500);
  const includeHtml = opts.includeHtml ?? false;
  const [product, html] = await Promise.all([
    fetchProduct(handle),
    includeHtml ? fetchProductHtml(handle) : Promise.resolve(''),
  ]);

  const primaryVariant = pickPrimaryVariant(product);
  const imageUrls = dedupeStrings([
    product.featured_image,
    ...(product.images ?? []),
  ]);

  return {
    handle,
    width,
    product,
    primaryVariant,
    productUrl: toAbsoluteUrl(product.url || `/products/${product.handle ?? handle}`),
    descriptionText: htmlToText(product.description ?? ''),
    imageUrls,
    sizedImageUrls: imageUrls.map((url) => toSizedShopifyImageUrl(url, width)),
    gallery360: includeHtml ? extract360Gallery(html) : null,
  };
}

export function buildInfoRows(
  bundle: YoutoozProductBundle,
  opts: { includeMediaSummary?: boolean } = {},
): Array<{ field: string; value: string }> {
  const includeMediaSummary = opts.includeMediaSummary ?? true;
  const rows: Array<{ field: string; value: string }> = [
    { field: 'Title', value: bundle.product.title ?? '' },
    { field: 'Handle', value: bundle.product.handle ?? bundle.handle },
    { field: 'Product ID', value: String(bundle.product.id ?? '') },
    { field: 'Variant ID', value: bundle.primaryVariant?.id ? String(bundle.primaryVariant.id) : '' },
    { field: 'Price', value: formatMoneyCents(bundle.primaryVariant?.price ?? bundle.product.price) },
    { field: 'Compare At Price', value: formatMoneyCents(bundle.primaryVariant?.compare_at_price ?? bundle.product.compare_at_price) },
    { field: 'Available', value: String(bundle.primaryVariant?.available ?? bundle.product.available ?? false) },
    { field: 'Vendor', value: bundle.product.vendor ?? '' },
    { field: 'Type', value: bundle.product.type ?? '' },
    { field: 'SKU', value: bundle.primaryVariant?.sku ?? '' },
    { field: 'Barcode', value: bundle.primaryVariant?.barcode ?? '' },
    { field: 'Published At', value: bundle.product.published_at ?? '' },
    { field: 'Created At', value: bundle.product.created_at ?? '' },
    { field: 'Tags', value: (bundle.product.tags ?? []).join(', ') },
    { field: 'URL', value: bundle.productUrl },
    { field: 'Description', value: bundle.descriptionText },
  ];

  if (includeMediaSummary) {
    rows.push(
      { field: 'Image Count', value: String(bundle.sizedImageUrls.length) },
      { field: 'Has 360 Gallery', value: String(Boolean(bundle.gallery360)) },
    );
    if (bundle.gallery360) {
      rows.push({ field: '360 Frame Count', value: String(bundle.gallery360.frameCount) });
    }
  }

  return rows.filter((row) => row.value !== '');
}

export function buildImageRows(
  bundle: YoutoozProductBundle,
): Array<{ index: number; role: string; width: number; url: string }> {
  return bundle.sizedImageUrls.map((url, index) => ({
    index: index + 1,
    role: index === 0 ? 'featured' : 'gallery',
    width: bundle.width,
    url,
  }));
}

export function build360Rows(
  gallery360: Youtooz360Gallery | null,
): Array<{ frame: number; url: string }> {
  if (!gallery360) return [];
  return gallery360.frames.map((url, index) => ({
    frame: index + 1,
    url,
  }));
}
