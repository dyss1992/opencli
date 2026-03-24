import { cli, Strategy } from '../../registry.js';
import { buildImageRows, fetchProductBundle } from './utils.js';

cli({
  site: 'youtooz',
  name: 'images',
  description: 'Get Youtooz product image URLs only',
  domain: 'youtooz.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'target', positional: true, required: true, help: 'Youtooz product URL or handle' },
    { name: 'width', type: 'int', default: 1500, help: 'Image width for Shopify CDN URLs' },
  ],
  columns: ['index', 'role', 'width', 'url'],
  func: async (_page, kwargs) => {
    const bundle = await fetchProductBundle(String(kwargs.target ?? ''), {
      width: kwargs.width,
      includeHtml: false,
    });
    return buildImageRows(bundle);
  },
});
