import { cli, Strategy } from '../../registry.js';
import {
  build360Rows,
  buildImageRows,
  buildInfoRows,
  fetchProductBundle,
} from './utils.js';

cli({
  site: 'youtooz',
  name: 'product',
  description: 'Get Youtooz product info, 1500px images, and 360 frames',
  domain: 'youtooz.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'target', positional: true, required: true, help: 'Youtooz product URL or handle' },
    { name: 'width', type: 'int', default: 1500, help: 'Image width for Shopify CDN URLs' },
  ],
  columns: ['field', 'value'],
  func: async (_page, kwargs) => {
    const bundle = await fetchProductBundle(String(kwargs.target ?? ''), {
      width: kwargs.width,
      includeHtml: true,
    });

    const rows = buildInfoRows(bundle, { includeMediaSummary: true });

    if (bundle.sizedImageUrls.length > 0) {
      rows.push({
        field: `Featured Image ${bundle.width}`,
        value: bundle.sizedImageUrls[0],
      });
    }

    if (bundle.gallery360) {
      rows.push(
        { field: '360 Source', value: bundle.gallery360.resolvedSource },
        { field: '360 Preview', value: bundle.gallery360.preview },
      );
    }

    for (const frame of build360Rows(bundle.gallery360)) {
      rows.push({
        field: `360 Frame #${frame.frame}`,
        value: frame.url,
      });
    }

    for (const image of buildImageRows(bundle)) {
      rows.push({
        field: `Image ${bundle.width} #${image.index}`,
        value: image.url,
      });
    }

    return rows;
  },
});
