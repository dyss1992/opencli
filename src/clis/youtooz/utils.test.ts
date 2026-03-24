import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  build360Rows,
  buildImageRows,
  buildInfoRows,
  dedupeStrings,
  expandFramePattern,
  extract360Gallery,
  fetchProductBundle,
  fetchProductHtml,
  fetchProduct,
  formatMoneyCents,
  htmlToText,
  normalizeImageWidth,
  normalizeProductHandle,
  pickPrimaryVariant,
  resolveYoutooz360Source,
  toAbsoluteUrl,
  toSizedShopifyImageUrl,
} from './utils.js';

describe('normalizeProductHandle', () => {
  it('extracts handle from product url', () => {
    expect(normalizeProductHandle('https://youtooz.com/products/leatherface?variant=1')).toBe('leatherface');
  });

  it('supports bare handle and product path', () => {
    expect(normalizeProductHandle('leatherface')).toBe('leatherface');
    expect(normalizeProductHandle('/products/leatherface.js')).toBe('leatherface');
  });
});

describe('toAbsoluteUrl', () => {
  it('normalizes protocol-relative urls', () => {
    expect(toAbsoluteUrl('//cdn.shopify.com/image.png?v=1')).toBe('https://cdn.shopify.com/image.png?v=1');
  });
});

describe('toSizedShopifyImageUrl', () => {
  it('adds width parameter while preserving existing query params', () => {
    expect(toSizedShopifyImageUrl('//cdn.shopify.com/image.png?v=1', 1500)).toBe(
      'https://cdn.shopify.com/image.png?v=1&width=1500'
    );
  });
});

describe('htmlToText', () => {
  it('flattens html into readable plain text', () => {
    expect(htmlToText('<h2>Hello</h2><p>World &amp; more</p>')).toBe('Hello | World & more');
  });
});

describe('formatMoneyCents', () => {
  it('formats cents as decimal money', () => {
    expect(formatMoneyCents(2999)).toBe('29.99');
    expect(formatMoneyCents(null)).toBe('');
  });
});

describe('normalizeImageWidth', () => {
  it('clamps width to the supported range', () => {
    expect(normalizeImageWidth(1500)).toBe(1500);
    expect(normalizeImageWidth(10)).toBe(100);
    expect(normalizeImageWidth(99999)).toBe(4000);
    expect(normalizeImageWidth('bad')).toBe(1500);
  });
});

describe('dedupeStrings', () => {
  it('removes empty and duplicate values while preserving order', () => {
    expect(dedupeStrings(['a', '', 'b', 'a', null, 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });
});

describe('resolveYoutooz360Source', () => {
  it('maps cdn.youtooz 360 pattern to the public image host', () => {
    expect(resolveYoutooz360Source('https://cdn.youtooz.com/r2023-production/04kq6s/{0..34}.jpg')).toBe(
      'https://main-site-product-360.youtooz.com/r2023-production/04kq6s/{0..34}.jpg'
    );
  });
});

describe('expandFramePattern', () => {
  it('expands numeric ranges into individual frame urls', () => {
    expect(expandFramePattern('https://host/item/{0..2}.jpg')).toEqual([
      'https://host/item/0.jpg',
      'https://host/item/1.jpg',
      'https://host/item/2.jpg',
    ]);
  });

  it('preserves zero padding in ranges', () => {
    expect(expandFramePattern('https://host/item/{00..02}.jpg')).toEqual([
      'https://host/item/00.jpg',
      'https://host/item/01.jpg',
      'https://host/item/02.jpg',
    ]);
  });
});

describe('extract360Gallery', () => {
  it('extracts and expands the 360 gallery block from html', () => {
    const html = `
      <li data-gallery-preview="custom:360"
          data-gallery-source="https://cdn.youtooz.com/r2023-production/04kq6s/{0..2}.jpg">
        <a href="https://main-site-product-360.youtooz.com/r2023-production/04kq6s/0.jpg"></a>
      </li>
    `;

    expect(extract360Gallery(html)).toEqual({
      source: 'https://cdn.youtooz.com/r2023-production/04kq6s/{0..2}.jpg',
      resolvedSource: 'https://main-site-product-360.youtooz.com/r2023-production/04kq6s/{0..2}.jpg',
      preview: 'https://main-site-product-360.youtooz.com/r2023-production/04kq6s/0.jpg',
      frameCount: 3,
      frames: [
        'https://main-site-product-360.youtooz.com/r2023-production/04kq6s/0.jpg',
        'https://main-site-product-360.youtooz.com/r2023-production/04kq6s/1.jpg',
        'https://main-site-product-360.youtooz.com/r2023-production/04kq6s/2.jpg',
      ],
    });
  });
});

describe('fetchProduct', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns parsed product data on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 1, title: 'Leatherface' }),
    }));

    await expect(fetchProduct('leatherface')).resolves.toEqual({ id: 1, title: 'Leatherface' });
  });

  it('throws when product is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({}),
    }));

    await expect(fetchProduct('missing-product')).rejects.toThrow('not found');
  });
});

describe('fetchProductHtml', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns html on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('<html></html>'),
    }));

    await expect(fetchProductHtml('leatherface')).resolves.toBe('<html></html>');
  });
});

describe('pickPrimaryVariant', () => {
  it('prefers an available variant', () => {
    expect(pickPrimaryVariant({
      variants: [
        { id: 1, available: false },
        { id: 2, available: true },
      ],
    })).toEqual({ id: 2, available: true });
  });
});

describe('fetchProductBundle', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('combines product, sized images, and 360 gallery data', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          id: 1,
          title: 'Bubsy',
          handle: 'bubsy',
          url: '/products/bubsy',
          description: '<p>Hello</p>',
          featured_image: '//cdn.shopify.com/a.png?v=1',
          images: ['//cdn.shopify.com/a.png?v=1', '//cdn.shopify.com/b.png?v=2'],
          variants: [{ id: 10, available: true, price: 2999 }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve('<li data-gallery-preview="custom:360" data-gallery-source="https://cdn.youtooz.com/r2023-production/demo/{0..1}.jpg"></li>'),
      }));

    const bundle = await fetchProductBundle('bubsy', { width: 1500, includeHtml: true });
    expect(bundle.handle).toBe('bubsy');
    expect(bundle.productUrl).toBe('https://youtooz.com/products/bubsy');
    expect(bundle.sizedImageUrls).toEqual([
      'https://cdn.shopify.com/a.png?v=1&width=1500',
      'https://cdn.shopify.com/b.png?v=2&width=1500',
    ]);
    expect(bundle.gallery360?.frameCount).toBe(2);
  });
});

describe('buildInfoRows', () => {
  it('renders compact product fields', () => {
    const rows = buildInfoRows({
      handle: 'bubsy',
      width: 1500,
      product: {
        id: 1,
        title: 'Bubsy',
        handle: 'bubsy',
        vendor: 'Youtooz',
        type: 'Plush',
        tags: ['new'],
        published_at: '2026-01-01',
        created_at: '2025-12-31',
      },
      primaryVariant: { id: 10, available: true, price: 2999, sku: 'SKU-1', barcode: 'BAR-1' },
      productUrl: 'https://youtooz.com/products/bubsy',
      descriptionText: 'Hello',
      imageUrls: ['https://cdn.shopify.com/a.png?v=1'],
      sizedImageUrls: ['https://cdn.shopify.com/a.png?v=1&width=1500'],
      gallery360: { source: 'src', resolvedSource: 'src', preview: 'p', frameCount: 2, frames: ['p', 'q'] },
    });

    expect(rows).toContainEqual({ field: 'Title', value: 'Bubsy' });
    expect(rows).toContainEqual({ field: 'Image Count', value: '1' });
    expect(rows).toContainEqual({ field: '360 Frame Count', value: '2' });
  });
});

describe('buildImageRows', () => {
  it('labels featured and gallery images', () => {
    expect(buildImageRows({
      handle: 'bubsy',
      width: 1500,
      product: {},
      primaryVariant: null,
      productUrl: '',
      descriptionText: '',
      imageUrls: ['a', 'b'],
      sizedImageUrls: ['a1500', 'b1500'],
      gallery360: null,
    })).toEqual([
      { index: 1, role: 'featured', width: 1500, url: 'a1500' },
      { index: 2, role: 'gallery', width: 1500, url: 'b1500' },
    ]);
  });
});

describe('build360Rows', () => {
  it('converts a gallery into frame rows', () => {
    expect(build360Rows({
      source: 'src',
      resolvedSource: 'src',
      preview: 'a',
      frameCount: 2,
      frames: ['a', 'b'],
    })).toEqual([
      { frame: 1, url: 'a' },
      { frame: 2, url: 'b' },
    ]);
  });
});
