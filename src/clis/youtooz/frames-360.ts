import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { build360Rows, fetchProductBundle } from './utils.js';

cli({
  site: 'youtooz',
  name: 'frames-360',
  description: 'Get Youtooz 360 sequence frame URLs only',
  domain: 'youtooz.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'target', positional: true, required: true, help: 'Youtooz product URL or handle' },
  ],
  columns: ['frame', 'url'],
  func: async (_page, kwargs) => {
    const bundle = await fetchProductBundle(String(kwargs.target ?? ''), { includeHtml: true });
    if (!bundle.gallery360) {
      throw new CliError('NOT_FOUND', 'No 360 gallery found for this product', 'This product may not have 360 sequence frames');
    }
    return build360Rows(bundle.gallery360);
  },
});
