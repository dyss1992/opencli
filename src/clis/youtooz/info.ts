import { cli, Strategy } from '../../registry.js';
import { buildInfoRows, fetchProductBundle } from './utils.js';

cli({
  site: 'youtooz',
  name: 'info',
  description: 'Get Youtooz product info only',
  domain: 'youtooz.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'target', positional: true, required: true, help: 'Youtooz product URL or handle' },
  ],
  columns: ['field', 'value'],
  func: async (_page, kwargs) => {
    const bundle = await fetchProductBundle(String(kwargs.target ?? ''), { includeHtml: true });
    return buildInfoRows(bundle, { includeMediaSummary: true });
  },
});
