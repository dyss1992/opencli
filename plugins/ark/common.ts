import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IPage } from '@jackwener/opencli/registry';

export const SITE = 'ark';
export const ORDER_QUERY_URL = 'https://ark.xiaohongshu.com/app-order/order/query';
export const PRODUCT_LIST_URL = 'https://ark.xiaohongshu.com/app-item/list/shelf';
export const ORDER_DETAIL_URL_PREFIX = 'https://ark.xiaohongshu.com/app-order/order/detail/';
export const AFTERSALE_DETAIL_URL_PREFIX =
  'https://ark.xiaohongshu.com/app-order/aftersale/detail?returnId=';

const ORDER_PAGE_API_PATH = '/api/edith/fulfillment/order/page';
const ORDER_DETAIL_API_PATH = '/api/edith/fulfillment/order/detail';
const ORDER_BATCH_MARK_API_PATH = '/api/edith/fulfillment/order/batch_mark';
const ORDER_EXPORT_START_API_PATH = '/api/edith/fulfillment/tool/file/start_export';
const ORDER_EXPORT_WATCH_API_PATH = '/api/edith/fulfillment/tool/file/watch_export';
const PRODUCT_SEARCH_API_PATH = '/api/edith/product/search_item_v2';
const PRODUCT_SKUS_API_PATH = '/api/edith/product/get_skus_by_item_ids';
const PRODUCT_AVAILABILITY_API_PATH = '/api/edith/product/batch_update_availability_v3';
const LINE_SPLIT_RE = /\r?\n+/;
const TIMESTAMP_RE = /^\d{4}[-/]\d{2}[-/]\d{2}\s+\d{2}:\d{2}:\d{2}$/;
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_EXPORT_SOURCE_BEAN = 'OrderQueryPackageFileBuilder';

export const ORDER_LIST_STATUS_OPTIONS = [
  { key: 'all', label: '全部订单', statusList: [] },
  { key: 'unshipped', label: '待发货', statusList: [4, 5] },
  { key: 'partial', label: '部分发货', statusList: [55] },
  { key: 'shipped', label: '已发货', statusList: [6] },
  { key: 'completed', label: '交易完成', statusList: [7] },
  { key: 'cancelled', label: '已取消', statusList: [998] },
] as const;

export const ORDER_LIST_SORT_OPTIONS = [
  { key: 'ordered-desc', field: 'ordered_at', exportField: 'ordered_at', desc: true, label: '最新下单时间在上' },
  { key: 'ordered-asc', field: 'ordered_at', exportField: 'ordered_at', desc: false, label: '最早下单时间在上' },
  { key: 'paid-desc', field: 'paid_at', exportField: 'paid_at', desc: true, label: '最新支付时间在上' },
  { key: 'paid-asc', field: 'paid_at', exportField: 'paid_at', desc: false, label: '最早支付时间在上' },
] as const;

export const ORDER_SELLER_MARK_PRIORITY_OPTIONS = [
  { key: 'gray', label: '灰色', priority: 1 },
  { key: 'red', label: '红色', priority: 2 },
  { key: 'orange', label: '橘色', priority: 3 },
  { key: 'green', label: '绿色', priority: 4 },
  { key: 'blue', label: '蓝色', priority: 5 },
  { key: 'purple', label: '紫色', priority: 6 },
] as const;

export const PRODUCT_PAGE_OPTIONS = [
  { key: 'all', label: '全部', cardType: 1, url: 'https://ark.xiaohongshu.com/app-item/list/all' },
  { key: 'on-sale', label: '售卖中', cardType: 2, url: PRODUCT_LIST_URL },
  { key: 'off-sale', label: '已下架', cardType: 3, url: 'https://ark.xiaohongshu.com/app-item/list/unShelf' },
  { key: 'frozen', label: '已冻结', cardType: 4, url: 'https://ark.xiaohongshu.com/app-item/list/freeze' },
] as const;

const PRODUCT_PAGE_ALIASES = new Map<string, ProductPageKey>([
  ['all', 'all'],
  ['全部', 'all'],
  ['on-sale', 'on-sale'],
  ['onsale', 'on-sale'],
  ['shelf', 'on-sale'],
  ['selling', 'on-sale'],
  ['售卖中', 'on-sale'],
  ['出售中', 'on-sale'],
  ['off-sale', 'off-sale'],
  ['offsale', 'off-sale'],
  ['un-shelf', 'off-sale'],
  ['unshelf', 'off-sale'],
  ['已下架', 'off-sale'],
  ['frozen', 'frozen'],
  ['freeze', 'frozen'],
  ['已冻结', 'frozen'],
]);

type JsonFetchResult = {
  ok: boolean;
  status: number;
  text: string;
  json: unknown;
};

type OrderTarget = {
  packageId: string;
  detailUrl: string;
};

type AftersaleTarget = {
  returnId: string;
  detailUrl: string;
};

type OrderListStatusKey = (typeof ORDER_LIST_STATUS_OPTIONS)[number]['key'];
type OrderListSortKey = (typeof ORDER_LIST_SORT_OPTIONS)[number]['key'];
type ProductPageKey = (typeof PRODUCT_PAGE_OPTIONS)[number]['key'];

type OrderPagePayloadOptions = {
  status?: unknown;
  start?: unknown;
  end?: unknown;
  keyword?: unknown;
  pageNo?: unknown;
  pageSize?: unknown;
  sort?: unknown;
};

type OrderExportPayloadOptions = {
  status?: unknown;
  start?: unknown;
  end?: unknown;
  sort?: unknown;
  packageIds?: unknown;
};

type OrderSellerMarkPayloadOptions = {
  packageId?: unknown;
  packageIds?: unknown;
  note?: unknown;
  priority?: unknown;
  flag?: unknown;
};

type ProductSearchPayloadOptions = {
  page?: unknown;
  keyword?: unknown;
  pageNo?: unknown;
  pageSize?: unknown;
};

type ProductAvailabilityPayloadOptions = {
  itemId?: unknown;
  skuId?: unknown;
  available?: boolean;
  asyncExec?: boolean;
};

type OrderPageApiResponse = {
  code?: number;
  success?: boolean;
  msg?: string;
  data?: {
    total?: number;
    packages?: unknown[];
  };
};

type OrderExportStartResponse = {
  code?: number;
  success?: boolean;
  msg?: string;
  data?: {
    success?: boolean;
    task_id?: string;
    taskId?: string;
  };
};

type OrderExportWatchResponse = {
  code?: number;
  success?: boolean;
  msg?: string;
  data?: {
    task?: {
      file_url?: string;
      fileUrl?: string;
      state?: string;
      progress?: number;
      message?: string;
    };
  };
};

type OrderApiResponse = {
  code?: number;
  success?: boolean;
  msg?: string;
  data?: {
    fulfillment_package?: Record<string, unknown>;
  };
};

type ProductSearchApiResponse = {
  code?: number;
  success?: boolean;
  msg?: string;
  data?: {
    total?: number;
    items?: unknown[];
    item_ids?: unknown[];
  };
};

type ProductSkusApiResponse = {
  code?: number;
  success?: boolean;
  msg?: string;
  data?: {
    skusMap?: Record<string, unknown>;
    skus_map?: Record<string, unknown>;
  };
};

export type ProductAvailabilityActionResult = {
  success: boolean;
  message: string;
  task_id: string;
  fail_data: Record<string, unknown>[];
  code: string;
  raw: unknown;
};

export type OrderSellerMarkActionResult = {
  success: boolean;
  message: string;
  code: string;
  results: Record<string, unknown>[];
  raw: unknown;
};

type AftersaleTimelineEvent = {
  name: string;
  at: string;
  refundAmount: string | null;
};

export type ParsedAftersaleDetail = {
  source: 'aftersale-detail-page';
  detail_url: string;
  return_id: string;
  order_id: string | null;
  aftersale_type: string | null;
  current_status: string | null;
  hero_message: string | null;
  requested_at: string | null;
  refund_amount: string | null;
  requested_quantity: string | null;
  reason: string | null;
  buyer_note: string | null;
  payment_method: string | null;
  ordered_at: string | null;
  refund_success_at: string | null;
  aftersale_finished_at: string | null;
  timeline_events: AftersaleTimelineEvent[];
};

export type ParsedOrderDetailItem = {
  sku_id: string | null;
  item_title: string | null;
  sku_specification: string | null;
  item_quantity: number | null;
  shipped: boolean;
  can_ship: boolean;
  express_company: string | null;
  express_no: string | null;
  cannot_ship_reason: string | null;
};

export type ParsedOrderDetail = {
  source: 'order-detail-api';
  detail_url: string;
  package_id: string;
  status_bucket: string;
  status_bucket_label: string;
  order_status: string | null;
  order_status_code: number | null;
  after_sale_status: string | null;
  after_sale_status_code: number | null;
  order_type: string | null;
  payment_method: string | null;
  total_order_amount: number | null;
  actual_paid: number | null;
  buyer_name: string | null;
  buyer_phone: string | null;
  buyer_nickname: string | null;
  receiver_address: string | null;
  ordered_at: string | null;
  paid_at: string | null;
  confirmed_at: string | null;
  promised_ship_at: string | null;
  shipped_at: string | null;
  finished_at: string | null;
  expected_finish_at: string | null;
  express_company: string | null;
  express_no: string | null;
  delivery_note: string | null;
  item_title: string | null;
  sku_specification: string | null;
  item_quantity: number | null;
  cannot_ship_reason: string | null;
  items: ParsedOrderDetailItem[];
  order_tags: string[];
  return_ids: string[];
  primary_return_id: string | null;
  aftersale_detail_urls: string[];
  primary_aftersale_detail_url: string | null;
  refund_success_at: string | null;
  aftersale_finished_at: string | null;
  aftersale_type: string | null;
  aftersale_lookup_error: string | null;
};

export type ParsedOrderPageRow = {
  source: 'order-page-api';
  package_id: string | null;
  order_id: string | null;
  status_code: number | null;
  status: string | null;
  after_sale_status: string | null;
  order_type: string | null;
  ordered_at: string | null;
  paid_at: string | null;
  promised_ship_at: string | null;
  buyer_nickname: string | null;
  buyer_name: string | null;
  buyer_phone: string | null;
  receiver_address: string | null;
  province: string | null;
  city: string | null;
  district: string | null;
  item_id: string | null;
  item_title: string | null;
  sku_id: string | null;
  sku_specification: string | null;
  sku_quantity: number | null;
  sku_paid_amount: number | null;
  sku_sold_price: number | null;
  total_order_amount: number | null;
  actual_paid: number | null;
  shipping_fee: number | null;
  xhs_sku_code: string | null;
  barcode: string | null;
  merchant_code: string | null;
  seller_mark_priority: number | null;
  seller_mark_note: string | null;
};

export type OrderPageResult = {
  total: number;
  packages: Record<string, unknown>[];
};

export type OrderExportTask = {
  task_id: string;
};

export type OrderExportWatchResult = {
  task_id: string;
  state: string | null;
  progress: number | null;
  message: string | null;
  file_url: string | null;
};

export type DownloadedExportFile = {
  file: string;
  bytes: number;
};

export type ProductPageResult = {
  total: number;
  total_reported?: boolean;
  response_verified?: boolean;
  products: Record<string, unknown>[];
  itemIds: string[];
};

export type ProductSkuRowsInput = {
  products?: Record<string, unknown>[];
  skuMap: Record<string, unknown>;
};

export type ParsedProductSkuRow = {
  source: 'product-page-api' | 'product-skus-api';
  item_id: string | null;
  sku_id: string | null;
  scsku_code: string | null;
  barcode: string | null;
  merchant_code: string | null;
  item_title: string | null;
  item_title_with_brand: string | null;
  sku_name: string | null;
  sku_specification: string | null;
  variant_name: string | null;
  article_no: string | null;
  brand_name: string | null;
  category_path: string | null;
  price: number | null;
  stock: number | null;
  total_stock: number | null;
  stock_scope: 'sku' | 'single-sku-item-total' | 'item-total-only';
  sale_qty_30: number | null;
  sale_qty_total: number | null;
  available: boolean;
  buyable: boolean;
  status: string;
  created_at: string | null;
  updated_at: string | null;
  on_shelf_at: string | null;
};

export function resolveOrderListStatus(rawStatus: unknown = 'unshipped') {
  const value = normalizeLookup(rawStatus || 'unshipped');
  const option = ORDER_LIST_STATUS_OPTIONS.find((entry) => {
    return normalizeLookup(entry.key) === value || normalizeLookup(entry.label) === value;
  });
  if (!option) {
    throw new Error(
      `Unknown order status "${String(rawStatus)}". Available: ${ORDER_LIST_STATUS_OPTIONS.map((entry) => entry.key).join(', ')}`,
    );
  }
  return {
    key: option.key,
    label: option.label,
    statusList: [...option.statusList],
  };
}

export function resolveOrderListSort(rawSort: unknown = 'ordered-desc') {
  const value = normalizeLookup(rawSort || 'ordered-desc');
  const option = ORDER_LIST_SORT_OPTIONS.find((entry) => {
    return normalizeLookup(entry.key) === value || normalizeLookup(entry.label) === value;
  });
  if (!option) {
    throw new Error(
      `Unknown order sort "${String(rawSort)}". Available: ${ORDER_LIST_SORT_OPTIONS.map((entry) => entry.key).join(', ')}`,
    );
  }
  return { ...option };
}

export function buildOrderPagePayload(options: OrderPagePayloadOptions = {}): Record<string, unknown> {
  const status = resolveOrderListStatus(options.status);
  const sort = resolveOrderListSort(options.sort);
  const range = buildOrderTimeRange(options.start, options.end);
  return {
    page_no: toPositiveInteger(options.pageNo, 1),
    page_size: toPositiveInteger(options.pageSize, DEFAULT_PAGE_SIZE),
    multi_search_field: cleanText(options.keyword),
    order_tag_list: [],
    order_type_list: [],
    promise_ship_time_type_list: [],
    after_sale_status_list: [],
    status: status.statusList,
    time_range_list: [{
      time_type: 3,
      start_time: range.startMs,
      end_time: range.endMs,
    }],
    seller_mark_priority_list: [],
    seller_mark_note_status_list: [],
    overdue_status: -2,
    sort_by: { sort_field: sort.field, desc: sort.desc },
    need_declare_info: true,
    need_declare_times: true,
    allow_es_fallback: true,
  };
}

export function buildOrderExportPayload(options: OrderExportPayloadOptions = {}): Record<string, unknown> {
  const status = resolveOrderListStatus(options.status);
  const sort = resolveOrderListSort(options.sort);
  const range = buildOrderTimeRange(options.start, options.end);
  const packageIds = Array.isArray(options.packageIds)
    ? options.packageIds.map((item) => cleanText(item)).filter(Boolean)
    : [];
  const dataCondition = {
    order_tag_list: [],
    order_type_list: [],
    time_range_list: [{
      timeType: 'ordered',
      startTime: range.startMs,
      endTime: range.endMs,
    }],
    seller_mark_priority_list: [],
    seller_mark_note_status_list: [],
    overdue_status: -2,
    status_list: status.statusList,
    sort_by: { sortField: sort.exportField, desc: sort.desc },
    package_ids: packageIds,
    need_declare_info: true,
    need_declare_times: true,
  };
  return {
    data_condition: JSON.stringify(dataCondition),
    source_data_bean: DEFAULT_EXPORT_SOURCE_BEAN,
  };
}

export function resolveOrderSellerMarkPriority(rawPriority: unknown): number {
  const rawText = cleanText(rawPriority);
  if (!rawText) {
    throw new Error('seller mark priority is required');
  }
  const numeric = Number(rawText);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 6) {
    return numeric;
  }

  const normalized = normalizeLookup(rawText);
  const aliases = new Map<string, number>([
    ['grey', 1],
    ['gray', 1],
    ['灰色', 1],
    ['red', 2],
    ['红色', 2],
    ['orange', 3],
    ['yellow', 3],
    ['橘色', 3],
    ['黄色', 3],
    ['green', 4],
    ['绿色', 4],
    ['blue', 5],
    ['蓝色', 5],
    ['purple', 6],
    ['violet', 6],
    ['紫色', 6],
  ]);
  const resolved = aliases.get(normalized);
  if (!resolved) {
    throw new Error(
      `Unknown seller mark priority "${rawText}". Available: ${ORDER_SELLER_MARK_PRIORITY_OPTIONS.map((entry) => entry.key).join(', ')}`,
    );
  }
  return resolved;
}

export function buildOrderSellerMarkPayload(
  options: OrderSellerMarkPayloadOptions = {},
): Record<string, unknown> {
  const rawPackageIds = Array.isArray(options.packageIds)
    ? options.packageIds
    : [options.packageId, options.packageIds];
  const packageIds = uniqueStrings(rawPackageIds.map((item) => cleanText(item)).filter(Boolean));
  if (!packageIds.length) throw new Error('package-id is required');

  const note = cleanText(options.note);
  if (!note) throw new Error('seller mark note is required');
  if (note.length > 500) throw new Error('seller mark note must be 500 characters or shorter');

  const priority = resolveOrderSellerMarkPriority(options.priority ?? options.flag);
  return {
    package_ids: packageIds,
    seller_mark_note: note,
    seller_mark_priority: priority,
  };
}

export function parseOrderSellerMarkResponse(
  response: Partial<JsonFetchResult>,
): OrderSellerMarkActionResult {
  const raw = response.json ?? null;
  const root = asRecord(raw);
  const data = asRecord(root.data);
  const results = toRecordList(data.res ?? root.res);
  const code = root.code === undefined || root.code === null ? '' : String(root.code);
  const httpSuccess = response.status === undefined || (Number(response.status) >= 200 && Number(response.status) < 300);
  const apiSuccess = root.success !== false && (!code || code === '0');
  const failedResults = results.filter((item) => item.success === false);
  const success = httpSuccess && apiSuccess && results.length > 0 && failedResults.length === 0;
  const resultMessages = results
    .map((item) => asOptionalString(item.msg ?? item.message))
    .filter((item): item is string => Boolean(item));
  const message = uniqueStrings([
    asOptionalString(root.msg ?? root.message),
    asOptionalString(data.msg ?? data.message),
    ...resultMessages,
    success ? 'success' : null,
  ]).join('；');

  return {
    success,
    message: message || (success ? 'success' : 'unknown error'),
    code,
    results,
    raw,
  };
}

export function normalizeBuyerPhone(rawPhone: unknown): string | null {
  const value = asOptionalString(rawPhone);
  if (!value) return null;
  return value.replace(/^(\d{3})\*{3}(\d{4})$/, '$1****$2');
}

export function flattenOrderPackageRows(orderPackage: Record<string, unknown>): ParsedOrderPageRow[] {
  const userInfo = asRecord(orderPackage.userInfo ?? orderPackage.user_info);
  const sellerMarkInfo = asRecord(orderPackage.sellerMarkInfo ?? orderPackage.seller_mark_info);
  const packageId = asOptionalString(orderPackage.packageId ?? orderPackage.package_id);
  const orderId = asOptionalString(orderPackage.orderId ?? orderPackage.order_id);
  const skus = toRecordList(orderPackage.skus);
  const skuRows = skus.length > 0 ? skus : [{}];
  const rows: ParsedOrderPageRow[] = [];

  for (const sku of skuRows) {
    const scskus = toRecordList(sku.scskus);
    const scskuRows = scskus.length > 0 ? scskus : [sku];
    for (const scsku of scskuRows) {
      const skuId = asOptionalString(scsku.skuId ?? scsku.sku_id)
        ?? asOptionalString(sku.skuId ?? sku.sku_id);
      const skuSpecification = asOptionalString(scsku.specification)
        ?? asOptionalString(sku.skuSpecification ?? sku.sku_specification);
      const itemTitle = asOptionalString(sku.displayName ?? sku.display_name)
        ?? asOptionalString(sku.skuName ?? sku.sku_name)
        ?? asOptionalString(scsku.name ?? scsku.skuName ?? scsku.sku_name);

      rows.push({
        source: 'order-page-api',
        package_id: packageId,
        order_id: orderId,
        status_code: toNumberOrNull(orderPackage.status),
        status: asOptionalString(orderPackage.statusDesc ?? orderPackage.status_desc),
        after_sale_status: asOptionalString(orderPackage.afterSaleStatusDesc ?? orderPackage.after_sale_status_desc),
        order_type: asOptionalString(orderPackage.typeDesc ?? orderPackage.type_desc),
        ordered_at: asOptionalString(orderPackage.orderedAt ?? orderPackage.ordered_at),
        paid_at: asOptionalString(orderPackage.paidAt ?? orderPackage.paid_at),
        promised_ship_at: asOptionalString(orderPackage.promiseLastShipAt ?? orderPackage.promise_last_ship_at),
        buyer_nickname: asOptionalString(userInfo.nickName ?? userInfo.nick_name),
        buyer_name: asOptionalString(userInfo.name),
        buyer_phone: normalizeBuyerPhone(userInfo.phone),
        receiver_address: asOptionalString(userInfo.address) ?? joinAddressParts(userInfo) ?? null,
        province: asOptionalString(userInfo.province),
        city: asOptionalString(userInfo.city),
        district: asOptionalString(userInfo.district),
        item_id: asOptionalString(sku.itemId ?? sku.item_id),
        item_title: itemTitle,
        sku_id: skuId,
        sku_specification: skuSpecification,
        sku_quantity: toNumberOrNull(scsku.quantity) ?? toNumberOrNull(sku.skuQuantity ?? sku.sku_quantity),
        sku_paid_amount: toNumberOrNull(scsku.paidAmount ?? scsku.paid_amount)
          ?? toNumberOrNull(sku.skuTotalPaidAmount ?? sku.sku_total_paid_amount),
        sku_sold_price: toNumberOrNull(scsku.soldPrice ?? scsku.sold_price)
          ?? toNumberOrNull(sku.skuSoldPrice ?? sku.sku_sold_price),
        total_order_amount: toNumberOrNull(orderPackage.totalOrderAmount ?? orderPackage.total_order_amount),
        actual_paid: toNumberOrNull(orderPackage.actualPaid ?? orderPackage.actual_paid),
        shipping_fee: toNumberOrNull(orderPackage.shippingFee ?? orderPackage.shipping_fee),
        xhs_sku_code: asOptionalString(scsku.scskuCode ?? scsku.scsku_code),
        barcode: asOptionalString(scsku.barcode),
        merchant_code: extractMerchantCode(scsku, sku),
        seller_mark_priority: toNumberOrNull(sellerMarkInfo.sellerMarkPriority ?? sellerMarkInfo.seller_mark_priority),
        seller_mark_note: asOptionalString(sellerMarkInfo.sellerMarkNote ?? sellerMarkInfo.seller_mark_note),
      });
    }
  }

  return rows;
}

export function resolveProductPage(rawPage: unknown = 'on-sale') {
  const value = normalizeLookup(rawPage || 'on-sale');
  const alias = PRODUCT_PAGE_ALIASES.get(value) ?? value;
  const option = PRODUCT_PAGE_OPTIONS.find((entry) => entry.key === alias);
  if (!option) {
    throw new Error(
      `Unknown product page "${String(rawPage)}". Available: ${PRODUCT_PAGE_OPTIONS.map((entry) => entry.key).join(', ')}`,
    );
  }
  return { ...option };
}

export function buildProductSearchPayload(
  options: ProductSearchPayloadOptions = {},
): Record<string, unknown> {
  const productPage = resolveProductPage(options.page);
  return {
    page_no: toPositiveInteger(options.pageNo, 1),
    page_size: toPositiveInteger(options.pageSize, 20),
    search_filter: {
      card_type: productPage.cardType,
      is_channel: false,
      whole_keywords: cleanText(options.keyword),
    },
    search_order: { sort_field: 'create_time', order: 'desc' },
    search_item_detail_option: {
      with_product_quality_score: productPage.key === 'on-sale',
      with_hot_item_award_text_info: productPage.key === 'on-sale',
      with_item_lock_info: true,
    },
  };
}

export function parseProductItemIds(rawItemIds: unknown): string[] {
  const values = Array.isArray(rawItemIds) ? rawItemIds : String(rawItemIds ?? '').split(/[\s,，]+/);
  return uniqueStrings(values.map((item) => asOptionalString(item)));
}

export function buildProductAvailabilityPayload(
  options: ProductAvailabilityPayloadOptions = {},
): Record<string, unknown> {
  const itemId = asOptionalString(options.itemId);
  const skuId = asOptionalString(options.skuId);
  const available = options.available !== false;
  const asyncExec = Boolean(options.asyncExec);
  if (!itemId) throw new Error('item-id is required');

  if (skuId) {
    return {
      available,
      itemIds: [],
      skuIds: [skuId],
      asyncExec,
      byModifyTool: true,
    };
  }

  return {
    available,
    itemIds: [itemId],
    skuIds: [],
    asyncExec,
    byModifyTool: true,
  };
}

export function parseProductAvailabilityResponse(
  response: Partial<JsonFetchResult>,
): ProductAvailabilityActionResult {
  const raw = response.json ?? null;
  const root = asRecord(raw);
  const data = asRecord(root.data);
  const failData = toRecordList(root.failData).length ? toRecordList(root.failData) : toRecordList(data.failData);
  const taskId = asOptionalString(root.taskId ?? root.task_id ?? data.taskId ?? data.task_id) ?? '';
  const code = asOptionalString(root.code) ?? '';
  const explicitSuccess = root.success;
  const httpSuccess = response.status === undefined || (Number(response.status) >= 200 && Number(response.status) < 300);
  const apiCodeSuccess = !code || code === '0';
  const success = httpSuccess
    && apiCodeSuccess
    && explicitSuccess !== false
    && failData.length === 0;
  const failMessages = failData
    .map((item) => asOptionalString(item.message ?? item.msg ?? item.reason))
    .filter((item): item is string => Boolean(item));
  const message = uniqueStrings([
    asOptionalString(root.msg ?? root.message),
    asOptionalString(data.msg ?? data.message),
    ...failMessages,
    success ? 'success' : null,
  ]).join('；');

  return {
    success,
    message: message || (success ? 'success' : 'unknown error'),
    task_id: taskId,
    fail_data: failData,
    code,
    raw,
  };
}

export function parseProductTableTextRows(rowTexts: string[]): Record<string, unknown>[] {
  return rowTexts.map((rowText) => {
    const lines = toLines(rowText);
    const joined = lines.join('\n');
    const title = lines[0] ?? null;
    const itemId = joined.match(/商品ID:\s*([A-Za-z0-9]+)/)?.[1] ?? null;
    const articleNo = joined.match(/商品货号:\s*([^\n]+)/)?.[1]?.trim() ?? null;
    const priceLineIndex = lines.findIndex((line) => /^¥\s*\d/.test(line));
    const priceRange = priceLineIndex >= 0 ? parsePriceRangeCents(lines[priceLineIndex]) : { min: null, max: null };
    const stock = priceLineIndex >= 0 ? toNumberOrNull(lines[priceLineIndex + 1]) : null;
    const saleQty30 = priceLineIndex >= 0 ? toNumberOrNull(lines[priceLineIndex + 2]) : null;
    const saleQtyTotal = toNumberOrNull(joined.match(/历史累计:\s*(\d+)/)?.[1]);
    const status = lines.find((line) => ['售卖中', '已下架', '已冻结', '审核中', '审核驳回', '审核通过'].includes(line)) ?? null;
    const statusIndex = status ? lines.indexOf(status) : -1;
    const onShelfTime = statusIndex >= 0
      ? joinDateAndTime(lines[statusIndex + 1], lines[statusIndex + 2])
      : null;

    return {
      item_id: itemId,
      item_name: title,
      item_name_with_brand_name: title,
      article_no: articleNo,
      min_price: priceRange.min,
      max_price: priceRange.max,
      total_stock: stock,
      buyable: status === '售卖中',
      deleted: false,
      item_freeze: status === '已冻结',
      dom_status: status,
      on_shelf_time: onShelfTime,
      sale_qty_info: {
        sale_qty30: saleQty30,
        acc_sale_qty: saleQtyTotal,
      },
    };
  }).filter((row) => Boolean(row.item_id));
}

export async function searchProductListUi(page: IPage, keyword: string): Promise<void> {
  const script = `
    (() => {
      const input = [...document.querySelectorAll('input')]
        .find((el) => (el.placeholder || '').includes('商品名称/ID'));
      if (!input) return { ok: false, reason: 'product search input not found' };
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(input, ${JSON.stringify(keyword)});
      else input.value = ${JSON.stringify(keyword)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
      return { ok: true, value: input.value };
    })()
  `;
  const result = await page.evaluate(script);
  if (!asRecord(result).ok) {
    throw new Error(asOptionalString(asRecord(result).reason) ?? 'Could not search Ark product list UI.');
  }
  await page.wait({ time: 4 });
}

export async function readVisibleProductRows(page: IPage): Promise<Record<string, unknown>[]> {
  const rowTexts = await page.evaluate(`
    (() => {
      const candidates = [...document.querySelectorAll('tr, [role=row], .d-table-row, .beer-table-row')];
      return candidates
        .map((el) => el.innerText || '')
        .filter((text) => text.includes('商品ID:') && /售卖中|已下架|已冻结|审核中|审核驳回|审核通过/.test(text));
    })()
  `);
  return parseProductTableTextRows(Array.isArray(rowTexts) ? rowTexts.map((item) => String(item)) : []);
}

export async function ensureProductListPage(
  page: IPage,
  rawProductPage: unknown = 'on-sale',
  refresh = true,
  timeoutSeconds = 150,
): Promise<{ href: string; title: string }> {
  if (!page) throw new Error('Browser page required');
  const productPage = resolveProductPage(rawProductPage);
  const targetUrl = refresh ? buildFreshUrl(productPage.url) : productPage.url;
  await page.goto(targetUrl, { settleMs: 2500 });

  const deadline = Date.now() + Math.max(5, timeoutSeconds) * 1000;
  let lastMeta: { href?: string; title?: string; ready?: boolean; loginLike?: boolean } | null = null;
  while (Date.now() < deadline) {
    lastMeta = await page.evaluate(`(() => {
      const bodyText = document.body?.innerText || '';
      return {
        href: location.href,
        title: document.title || '',
        ready: location.href.includes('/app-item/list/')
          && (
            bodyText.includes('商品管理')
            || bodyText.includes('商品ID')
            || bodyText.includes('商品名称/ID')
            || bodyText.includes('商品货号')
            || bodyText.includes('请输入商品名称/ID')
            || /共\\s*\\d+\\s*条/.test(bodyText)
          ),
        loginLike: location.href.includes('login') || bodyText.includes('登录') && bodyText.includes('验证码'),
      };
    })()`);
    if (lastMeta?.loginLike) {
      throw new Error('Xiaohongshu merchant backend redirected to login. Please log in in Chrome, then rerun the command.');
    }
    if (lastMeta?.ready) {
      return { href: lastMeta.href ?? productPage.url, title: lastMeta.title ?? '' };
    }
    await page.wait({ time: 1 });
  }
  throw new Error(`Xiaohongshu product page did not finish loading. Last URL: ${lastMeta?.href ?? 'unknown'}`);
}

export async function fetchProductSearchPage(
  page: IPage,
  payload: Record<string, unknown>,
): Promise<ProductPageResult> {
  const result = await fetchJsonFromPage(page, PRODUCT_SEARCH_API_PATH, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: payload,
  });
  const json = result.json as ProductSearchApiResponse | null;
  const products = json?.data?.items;
  if (!Array.isArray(products)) {
    throw new Error(
      `Product list request did not return items. HTTP ${result.status}. This Ark endpoint may reject direct reads; retry with --query-item-id when you already know the item id.`,
    );
  }
  return {
    total: Number(json?.data?.total ?? products.length),
    total_reported: typeof json?.data?.total === 'number' && Number.isSafeInteger(json.data.total) && json.data.total >= 0,
    response_verified: result.ok === true && result.status === 200 && json?.success === true && json?.code === 200,
    products: products.map((item) => asRecord(item)),
    itemIds: toStringList(json?.data?.item_ids).length
      ? toStringList(json?.data?.item_ids)
      : products.map((item) => asOptionalString(asRecord(item).item_id)).filter((item): item is string => Boolean(item)),
  };
}

export async function fetchProductSkuMap(
  page: IPage,
  itemIds: string[],
  requireVerifiedResponse = false,
): Promise<Record<string, unknown>> {
  if (!itemIds.length) return {};
  const result = await fetchJsonFromPage(page, PRODUCT_SKUS_API_PATH, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: {
      itemIds,
      skuDetailOption: {
        withWeight: true,
        withItemInfo: true,
        withCrossBorderInfo: true,
        withDepositPreSaleInfo: true,
        withLockInfo: true,
        withItemLockInfo: true,
      },
    },
  });
  const json = result.json as ProductSkusApiResponse | null;
  if (requireVerifiedResponse && (result.ok !== true || result.status !== 200 || json?.success !== true || json?.code !== 200)) {
    throw new Error('规格接口未明确返回成功，无法完成全店查重。');
  }
  const skuMap = asRecord(json?.data?.skusMap ?? json?.data?.skus_map);
  if (!skuMap || !Object.keys(skuMap).length) {
    throw new Error(`Product SKU request did not return skusMap. HTTP ${result.status}.`);
  }
  return skuMap;
}

export async function updateProductAvailability(
  page: IPage,
  options: ProductAvailabilityPayloadOptions = {},
  beforeAction?: () => Promise<void>,
): Promise<ProductAvailabilityActionResult> {
  const itemId = asOptionalString(options.itemId);
  const skuId = asOptionalString(options.skuId) ?? '';
  const available = options.available !== false;
  if (!itemId) throw new Error('item-id is required');

  const viewLabel = skuId ? '规格视图' : '商品视图';
  const operationLabel = available ? '上架' : '下架';
  const rowIdentity = skuId ? `规格ID: ${skuId}` : `商品ID: ${itemId}`;

  const viewResult = asRecord(await page.evaluate(`
    (() => {
      const viewLabel = ${JSON.stringify(viewLabel)};
      const candidates = [...document.querySelectorAll('*')]
        .filter((el) => el.childElementCount === 0 && (el.textContent || '').trim() === viewLabel);
      const target = candidates.find((el) => el.offsetParent !== null) || candidates[0];
      if (!target) return { ok: false, reason: viewLabel + ' not found' };
      target.click();
      return { ok: true };
    })()
  `));
  if (!viewResult.ok) {
    return productAvailabilityUiFailure(asOptionalString(viewResult.reason) ?? 'product view switch failed');
  }

  await page.wait({ time: 1 });
  await searchProductListUi(page, itemId);
  await beforeAction?.();

  const clickResult = asRecord(await page.evaluate(`
    (() => {
      const rowIdentity = ${JSON.stringify(rowIdentity)};
      const operationLabel = ${JSON.stringify(operationLabel)};
      const row = [...document.querySelectorAll('tr, [role=row], .d-table-row, .beer-table-row')]
        .find((el) => (el.innerText || '').includes(rowIdentity));
      if (!row) return { ok: false, reason: rowIdentity + ' not found' };
      const candidates = [...row.querySelectorAll('*')]
        .filter((el) => el.childElementCount === 0
          && (el.textContent || '').trim() === operationLabel
          && el.offsetParent !== null);
      const target = candidates[0];
      if (!target) return { ok: false, reason: operationLabel + ' action not found' };
      target.click();
      return { ok: true };
    })()
  `));
  if (!clickResult.ok) {
    return productAvailabilityUiFailure(asOptionalString(clickResult.reason) ?? 'product availability action not found');
  }

  await page.wait({ time: 1 });
  const confirmResult = asRecord(await page.evaluate(`
    (() => {
      const operationLabel = ${JSON.stringify(operationLabel)};
      const visibleDialogs = [...document.querySelectorAll('[role=dialog], .d-modal, .d-dialog')]
        .filter((el) => el.offsetParent !== null);
      const expired = visibleDialogs.find((el) => (el.innerText || '').includes('页面过期提醒'));
      if (expired) return { ok: false, reason: '当前小红书页面已过期，需要刷新后重试' };
      const dialog = visibleDialogs.find((el) => (el.innerText || '').includes('确定' + operationLabel + '商品'));
      if (!dialog) return { ok: true, confirmed: false };
      const buttons = [...dialog.querySelectorAll('button, .d-button')]
        .filter((el) => (el.textContent || '').trim() === '确定' && el.offsetParent !== null);
      const target = buttons[buttons.length - 1];
      if (!target) return { ok: false, reason: '确认按钮未找到' };
      target.click();
      return { ok: true, confirmed: true };
    })()
  `));
  if (!confirmResult.ok) {
    return productAvailabilityUiFailure(asOptionalString(confirmResult.reason) ?? 'product availability confirmation failed');
  }

  await page.wait({ time: 2 });
  return {
    success: true,
    message: confirmResult.confirmed ? '已通过平台页面确认操作' : '已通过平台页面提交操作',
    task_id: '',
    fail_data: [],
    code: '',
    raw: {
      mode: 'platform-ui',
      item_id: itemId,
      sku_id: skuId,
      available,
      confirmed: Boolean(confirmResult.confirmed),
    },
  };
}

function productAvailabilityUiFailure(message: string): ProductAvailabilityActionResult {
  return {
    success: false,
    message,
    task_id: '',
    fail_data: [],
    code: 'UI_ACTION_FAILED',
    raw: { mode: 'platform-ui', message },
  };
}

export async function updateOrderSellerMark(
  page: IPage,
  options: OrderSellerMarkPayloadOptions = {},
): Promise<OrderSellerMarkActionResult> {
  const result = await fetchJsonFromPage(page, ORDER_BATCH_MARK_API_PATH, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'bill-type': 'xhs',
    },
    body: buildOrderSellerMarkPayload(options),
  });
  return parseOrderSellerMarkResponse(result);
}

export function isProductSkuOnSale(row: Record<string, unknown>): boolean {
  if (Object.hasOwn(row, 'available') && Object.hasOwn(row, 'buyable')) {
    return toBoolean(row.available, false) && toBoolean(row.buyable, false);
  }
  const status = asOptionalString(row.status);
  if (status === '售卖中') return true;
  if (status === '已下架' || status === '不可售' || status === '已冻结' || status === '已删除') return false;
  return false;
}

export function flattenProductSkuRows(input: ProductSkuRowsInput): ParsedProductSkuRow[] {
  const products = input.products ?? [];
  const productByItemId = new Map<string, Record<string, unknown>>();
  for (const product of products) {
    const itemId = asOptionalString(product.item_id ?? product.itemId);
    if (itemId) productByItemId.set(itemId, product);
  }

  const rows: ParsedProductSkuRow[] = [];
  for (const [rawItemId, rawSkus] of Object.entries(input.skuMap)) {
    const itemId = asOptionalString(rawItemId);
    const product = (itemId ? productByItemId.get(itemId) : undefined) ?? {};
    const skuRows = toRecordList(rawSkus);
    for (const sku of skuRows) {
      const skuItemId = asOptionalString(sku.itemId ?? sku.item_id) ?? itemId;
      const matchedProduct = (skuItemId ? productByItemId.get(skuItemId) : undefined) ?? product;
      rows.push(flattenProductSkuRow(matchedProduct, sku, skuRows.length));
    }
  }
  return rows;
}

function flattenProductSkuRow(
  product: Record<string, unknown>,
  sku: Record<string, unknown>,
  skuCount: number,
): ParsedProductSkuRow {
  const itemId = asOptionalString(sku.itemId ?? sku.item_id)
    ?? asOptionalString(product.item_id ?? product.itemId);
  const saleQtyInfo = asRecord(product.sale_qty_info ?? product.saleQtyInfo);
  const brandInfo = asRecord(product.brand_info ?? product.brandInfo);
  const hasProduct = Object.keys(product).length > 0;
  const productTitle = asOptionalString(product.item_name ?? product.itemName);
  const productStock = toNumberOrNull(product.total_stock ?? product.totalStock);
  const skuPrice = centsToYuan(
    asRecord(sku.basePriceInfo ?? sku.base_price_info).price
      ?? sku.price
      ?? product.min_price
      ?? product.minPrice,
  );
  const skuStock = toNumberOrNull(sku.stock);
  const exactStock = skuStock ?? (skuCount === 1 ? productStock : null);
  const stockScope = skuStock !== null
    ? 'sku'
    : skuCount === 1
      ? 'single-sku-item-total'
      : 'item-total-only';
  const available = toBoolean(sku.available, toBoolean(product.buyable, false));
  const buyable = toBoolean(sku.buyable, toBoolean(product.buyable, available));

  return {
    source: hasProduct ? 'product-page-api' : 'product-skus-api',
    item_id: itemId,
    sku_id: asOptionalString(sku.skuId ?? sku.sku_id),
    scsku_code: asOptionalString(sku.scskuCode ?? sku.scsku_code),
    barcode: asOptionalString(sku.barcode),
    merchant_code: asOptionalString(sku.erpCode ?? sku.erp_code),
    item_title: productTitle,
    item_title_with_brand: asOptionalString(product.item_name_with_brand_name ?? product.itemNameWithBrandName),
    sku_name: asOptionalString(sku.skuName ?? sku.sku_name),
    sku_specification: formatSkuVariants(toRecordList(sku.variants)),
    variant_name: asOptionalString(sku.variantName ?? sku.variant_name),
    article_no: asOptionalString(product.article_no ?? product.articleNo),
    brand_name: asOptionalString(brandInfo.brand_name ?? brandInfo.brandName),
    category_path: formatCategoryPath(toRecordList(product.categories)),
    price: skuPrice,
    stock: exactStock,
    total_stock: productStock,
    stock_scope: stockScope,
    sale_qty_30: toNumberOrNull(saleQtyInfo.sale_qty30 ?? saleQtyInfo.saleQty30),
    sale_qty_total: toNumberOrNull(saleQtyInfo.acc_sale_qty ?? saleQtyInfo.accSaleQty),
    available,
    buyable,
    status: resolveProductSkuStatus(product, sku, available, buyable),
    created_at: formatChinaTimestamp(sku.createTime ?? sku.create_time ?? product.create_time ?? product.createTime),
    updated_at: formatChinaTimestamp(sku.updateTime ?? sku.update_time ?? product.update_time ?? product.updateTime),
    on_shelf_at: formatChinaTimestamp(product.on_shelf_time ?? product.onShelfTime ?? sku.firstBuyableTime),
  };
}

function formatSkuVariants(variants: Record<string, unknown>[]): string | null {
  const parts = variants.map((variant) => {
    const name = asOptionalString(variant.attributeName ?? variant.attribute_name);
    const value = asOptionalString(variant.attributeValue ?? variant.attribute_value);
    if (name && value) return `${name}: ${value}`;
    return value ?? name;
  }).filter((item): item is string => Boolean(item));
  return parts.length ? parts.join(' / ') : null;
}

function formatCategoryPath(categories: Record<string, unknown>[]): string | null {
  const names = categories.map((category) => asOptionalString(category.name)).filter((item): item is string => Boolean(item));
  return names.length ? names.join(' > ') : null;
}

function resolveProductSkuStatus(
  product: Record<string, unknown>,
  sku: Record<string, unknown>,
  available: boolean,
  buyable: boolean,
): string {
  const productStatus = asOptionalString(product.dom_status ?? product.domStatus);
  if (toBoolean(sku.deleted ?? product.deleted, false)) return '已删除';
  if (toBoolean(sku.freeze ?? product.item_freeze ?? product.itemFreeze, false)) return '已冻结';
  const onSaleSkuCount = toNumberOrNull(product.on_sale_sku_count ?? product.onSaleSkuCount);
  const offShelfSkuCount = toNumberOrNull(product.off_shelf_sku_count ?? product.offShelfSkuCount);
  if (onSaleSkuCount === 0 && offShelfSkuCount && offShelfSkuCount > 0) return '已下架';
  if (!available || !buyable) return '不可售';
  if (available && buyable) return '售卖中';
  if (productStatus) return productStatus;
  return '未知';
}

function centsToYuan(value: unknown): number | null {
  const numeric = toNumberOrNull(value);
  if (numeric === null) return null;
  return Number((numeric / 100).toFixed(2));
}

function formatChinaTimestamp(value: unknown): string | null {
  const text = asOptionalString(value);
  if (text && /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(text)) return text;
  const numeric = toNumberOrNull(value);
  if (numeric === null || numeric <= 0) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(numeric));
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const year = byType.get('year');
  const month = byType.get('month');
  const day = byType.get('day');
  const hour = byType.get('hour');
  const minute = byType.get('minute');
  const second = byType.get('second');
  if (!year || !month || !day || !hour || !minute || !second) return null;
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function parsePriceRangeCents(text: string): { min: number | null; max: number | null } {
  const numbers = [...text.matchAll(/(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
  const finiteNumbers = numbers.filter((item) => Number.isFinite(item));
  if (!finiteNumbers.length) return { min: null, max: null };
  return {
    min: Math.round(finiteNumbers[0] * 100),
    max: Math.round((finiteNumbers[1] ?? finiteNumbers[0]) * 100),
  };
}

function joinDateAndTime(datePart: string | undefined, timePart: string | undefined): string | null {
  const date = asOptionalString(datePart);
  const time = asOptionalString(timePart);
  if (!date || !time) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!/^\d{2}:\d{2}:\d{2}$/.test(time)) return null;
  return `${date} ${time}`;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

export function parseOrderTarget(rawTarget: unknown): OrderTarget {
  const value = String(rawTarget ?? '').trim();
  if (!value) {
    throw new Error(
      'Order target is required. Provide a package id like P782737960775325601 or an order-detail URL.',
    );
  }

  const packageId = extractPackageId(value);
  if (!packageId) {
    throw new Error(`Could not parse package id from target: ${value}`);
  }

  return {
    packageId,
    detailUrl: buildOrderDetailUrl(packageId),
  };
}

export function parseAftersaleTarget(rawTarget: unknown): AftersaleTarget {
  const value = String(rawTarget ?? '').trim();
  if (!value) {
    throw new Error(
      'Aftersale target is required. Provide a return id like R8829100179280886 or an aftersale-detail URL.',
    );
  }

  const returnId = extractReturnId(value);
  if (!returnId) {
    throw new Error(`Could not parse return id from target: ${value}`);
  }

  return {
    returnId,
    detailUrl: buildAftersaleDetailUrl(returnId),
  };
}

export function buildOrderDetailUrl(packageId: string): string {
  return `${ORDER_DETAIL_URL_PREFIX}${packageId}`;
}

export function buildAftersaleDetailUrl(returnId: string): string {
  return `${AFTERSALE_DETAIL_URL_PREFIX}${returnId}`;
}

export async function navigateTo(page: IPage, url: string): Promise<void> {
  await page.goto(url, { settleMs: 2500 });
  await page.wait({ time: 1 });
}

export async function ensureOrderQueryPage(
  page: IPage,
  refresh = true,
  timeoutSeconds = 35,
): Promise<{ href: string; title: string }> {
  if (!page) throw new Error('Browser page required');
  const targetUrl = refresh ? buildFreshUrl(ORDER_QUERY_URL) : ORDER_QUERY_URL;
  await page.goto(targetUrl, { settleMs: 2500 });

  const deadline = Date.now() + Math.max(5, timeoutSeconds) * 1000;
  let lastMeta: { href?: string; title?: string; ready?: boolean; loginLike?: boolean } | null = null;
  while (Date.now() < deadline) {
    lastMeta = await page.evaluate(`(() => {
      const bodyText = document.body?.innerText || '';
      return {
        href: location.href,
        title: document.title || '',
        ready: bodyText.includes('订单管理') && bodyText.includes('查询') && bodyText.includes('全部导出'),
        loginLike: location.href.includes('login') || bodyText.includes('登录') && bodyText.includes('验证码'),
      };
    })()`);
    if (lastMeta?.loginLike) {
      throw new Error('Xiaohongshu merchant backend redirected to login. Please log in in Chrome, then rerun the command.');
    }
    if (lastMeta?.ready) {
      return { href: lastMeta.href ?? ORDER_QUERY_URL, title: lastMeta.title ?? '' };
    }
    await page.wait({ time: 1 });
  }
  throw new Error(`Xiaohongshu order query page did not finish loading. Last URL: ${lastMeta?.href ?? 'unknown'}`);
}

export async function fetchOrderPage(
  page: IPage,
  payload: Record<string, unknown>,
): Promise<OrderPageResult> {
  const result = await fetchJsonFromPage(page, ORDER_PAGE_API_PATH, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'bill-type': 'xhs',
    },
    body: payload,
  });

  const json = result.json as OrderPageApiResponse | null;
  const packages = json?.data?.packages;
  if (!Array.isArray(packages)) {
    throw new Error(`Order page request did not return packages. HTTP ${result.status}.`);
  }
  return {
    total: Number(json?.data?.total ?? packages.length),
    packages: packages.map((item) => asRecord(item)),
  };
}

export async function startOrderExport(
  page: IPage,
  payload: Record<string, unknown>,
): Promise<OrderExportTask> {
  const result = await fetchJsonFromPage(page, ORDER_EXPORT_START_API_PATH, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'bill-type': 'xhs',
    },
    body: payload,
  });

  const json = result.json as OrderExportStartResponse | null;
  const taskId = asOptionalString(json?.data?.task_id ?? json?.data?.taskId);
  if (!taskId) {
    throw new Error(`Order export did not return task_id. HTTP ${result.status}.`);
  }
  return { task_id: taskId };
}

export async function watchOrderExport(
  page: IPage,
  taskId: string,
  timeoutSeconds = 180,
): Promise<OrderExportWatchResult> {
  const deadline = Date.now() + Math.max(5, timeoutSeconds) * 1000;
  let lastTask: OrderExportWatchResult = {
    task_id: taskId,
    state: null,
    progress: null,
    message: null,
    file_url: null,
  };

  while (Date.now() < deadline) {
    const result = await fetchJsonFromPage(page, ORDER_EXPORT_WATCH_API_PATH, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'bill-type': 'xhs',
      },
      body: { task_id: taskId },
    });
    const json = result.json as OrderExportWatchResponse | null;
    const task = json?.data?.task;
    lastTask = {
      task_id: taskId,
      state: asOptionalString(task?.state),
      progress: toNumberOrNull(task?.progress),
      message: asOptionalString(task?.message),
      file_url: asOptionalString(task?.file_url ?? task?.fileUrl),
    };
    if (lastTask.file_url) return lastTask;
    if (lastTask.state && /fail|error|失败|cancel|stop/i.test(lastTask.state)) {
      throw new Error(lastTask.message || `Order export failed with state ${lastTask.state}`);
    }
    await page.wait({ time: 2 });
  }
  throw new Error(
    `Order export did not finish within ${timeoutSeconds}s. Last state: ${lastTask.state ?? 'unknown'}, progress: ${lastTask.progress ?? 'unknown'}`,
  );
}

export async function downloadExportFile(
  fileUrl: string,
  rawDownloadDir: unknown,
): Promise<DownloadedExportFile> {
  const downloadDir = resolveDownloadDir(rawDownloadDir);
  fs.mkdirSync(downloadDir, { recursive: true });
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Failed to download export file. HTTP ${response.status}.`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const fileName = resolveExportFileName(fileUrl);
  const filePath = path.join(downloadDir, fileName);
  fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
  return { file: filePath, bytes: fs.statSync(filePath).size };
}

export function resolveDownloadDir(rawDir: unknown): string {
  const input = cleanText(rawDir);
  if (!input) return path.join(os.homedir(), 'Downloads');
  if (input === '~') return os.homedir();
  if (input.startsWith('~/')) return path.join(os.homedir(), input.slice(2));
  return path.resolve(input);
}

export async function fetchOrderDetailPackage(
  page: IPage,
  packageId: string,
): Promise<Record<string, unknown>> {
  const result = await fetchJsonFromPage(page, ORDER_DETAIL_API_PATH, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'bill-type': 'xhs',
    },
    body: {
      package_id: packageId,
      need_package_expensive_info: true,
      need_shipment_abnormal_info: true,
      need_modify_address_data: true,
      need_consult_record: true,
    },
  });

  const json = result.json as OrderApiResponse | null;
  const orderPackage = json?.data?.fulfillment_package;
  if (!orderPackage || typeof orderPackage !== 'object') {
    throw new Error(
      `Order detail request did not return fulfillment_package. HTTP ${result.status}.`,
    );
  }

  return orderPackage;
}

export async function readAftersaleDetail(
  page: IPage,
  returnId: string,
): Promise<ParsedAftersaleDetail> {
  const detailUrl = buildAftersaleDetailUrl(returnId);
  await navigateTo(page, detailUrl);

  const bodyText = await readBodyText(page);
  const lines = toLines(bodyText);
  const timelineEvents = extractAftersaleTimeline(lines);
  const currentStatus =
    timelineEvents[0]?.name ??
    extractHeroStatus(lines) ??
    findValueAfter(lines, '售后信息', 1);

  return {
    source: 'aftersale-detail-page',
    detail_url: detailUrl,
    return_id: returnId,
    order_id: findValueAfter(lines, '订单号'),
    aftersale_type: findValueAfter(lines, '售后信息', 1),
    current_status: currentStatus,
    hero_message: lines.find((line) => /退款成功|退款关闭|售后完成|处理中/.test(line)) ?? null,
    requested_at: findValueAfter(lines, '申请时间'),
    refund_amount: findValueAfter(lines, '退款金额'),
    requested_quantity: findValueAfter(lines, '申请件数'),
    reason: findValueAfter(lines, '售后原因'),
    buyer_note: findValueAfter(lines, '售后说明'),
    payment_method: findValueAfter(lines, '支付方式'),
    ordered_at: findValueAfter(lines, '下单时间'),
    refund_success_at: timelineEvents.find((event) => event.name === '退款成功')?.at ?? null,
    aftersale_finished_at:
      timelineEvents.find((event) => event.name === '售后完成')?.at ?? null,
    timeline_events: timelineEvents,
  };
}

export async function readBodyText(page: IPage): Promise<string> {
  const text = await page.evaluate(`
    (() => {
      return document.body?.innerText || '';
    })()
  `);

  return typeof text === 'string' ? text : String(text ?? '');
}

export function parseOrderPackage(
  detailUrl: string,
  orderPackage: Record<string, unknown>,
): ParsedOrderDetail {
  const userInfo = asRecord(orderPackage.user_info);
  const paymentInfo = asRecord(orderPackage.pay_unit_lite);
  const skus = toRecordList(orderPackage.skus);
  const firstSku = firstRecord(skus);
  const items = skus.map((sku): ParsedOrderDetailItem => ({
    sku_id: asOptionalString(sku.sku_id),
    item_title:
      asOptionalString(sku.sku_name) ??
      asOptionalString(sku.display_name) ??
      asOptionalString(sku.sku_title),
    sku_specification: asOptionalString(sku.sku_specification),
    item_quantity: toNumberOrNull(sku.sku_quantity),
    shipped: toBoolean(sku.shipped, false),
    can_ship: toBoolean(sku.can_ship, false),
    express_company: asOptionalString(sku.express_company_name),
    express_no: asOptionalString(sku.express_no),
    cannot_ship_reason: asOptionalString(sku.cannot_ship_reason),
  }));
  const afterSaleList = toRecordList(orderPackage.after_sale_list);
  const expressCompany = asOptionalString(orderPackage.express_company_name);
  const rawExpressNo = asOptionalString(orderPackage.express_no);
  const rawOrderTags = toStringList(orderPackage.order_tag_list);
  const isNoLogistics =
    Boolean(expressCompany?.includes('无物流')) || rawOrderTags.includes('NO_LOGISTICS_SHIP');
  const returnIds = uniqueStrings([
    ...afterSaleList.map((item) => asOptionalString(item.returns_id)),
    asOptionalString(firstSku.latest_returns_id),
  ]);
  const primaryReturnId = returnIds[0] ?? null;
  const aftersaleDetailUrls = returnIds.map((returnId) => buildAftersaleDetailUrl(returnId));

  return {
    source: 'order-detail-api',
    detail_url: detailUrl,
    package_id: asOptionalString(orderPackage.package_id) ?? extractPackageId(detailUrl) ?? detailUrl,
    status_bucket: normalizeOrderStatusBucket(
      toNumberOrNull(orderPackage.status),
      asOptionalString(orderPackage.after_sale_status_desc),
    ),
    status_bucket_label: normalizeOrderStatusBucketLabel(
      toNumberOrNull(orderPackage.status),
      asOptionalString(orderPackage.after_sale_status_desc),
    ),
    order_status: asOptionalString(orderPackage.status_desc),
    order_status_code: toNumberOrNull(orderPackage.status),
    after_sale_status: asOptionalString(orderPackage.after_sale_status_desc),
    after_sale_status_code: toNumberOrNull(orderPackage.after_sale_status),
    order_type:
      asOptionalString(orderPackage.type_desc) ??
      asOptionalString(orderPackage.type) ??
      asOptionalString(orderPackage.special_type),
    payment_method: asOptionalString(paymentInfo.payment_name),
    total_order_amount: toNumberOrNull(orderPackage.total_order_amount),
    actual_paid: toNumberOrNull(orderPackage.actual_paid),
    buyer_name: asOptionalString(userInfo.name),
    buyer_phone: asOptionalString(userInfo.phone),
    buyer_nickname: asOptionalString(userInfo.nick_name),
    receiver_address:
      asOptionalString(userInfo.address) ?? joinAddressParts(userInfo) ?? null,
    ordered_at: asOptionalString(orderPackage.ordered_at),
    paid_at: asOptionalString(orderPackage.paid_at),
    confirmed_at: asOptionalString(orderPackage.confirmed_at),
    promised_ship_at: asOptionalString(orderPackage.promise_last_ship_at),
    shipped_at:
      asOptionalString(orderPackage.shipped_at) ??
      asOptionalString(orderPackage.latest_shipped_at),
    finished_at: asOptionalString(orderPackage.finished_at),
    expected_finish_at: asOptionalString(orderPackage.expected_finish_time),
    express_company: expressCompany,
    express_no: isNoLogistics ? null : rawExpressNo,
    delivery_note: isNoLogistics ? rawExpressNo : null,
    item_title:
      asOptionalString(firstSku.sku_name) ??
      asOptionalString(firstSku.display_name) ??
      asOptionalString(firstSku.sku_title),
    sku_specification: asOptionalString(firstSku.sku_specification),
    item_quantity: toNumberOrNull(firstSku.sku_quantity),
    cannot_ship_reason: asOptionalString(firstSku.cannot_ship_reason),
    items,
    order_tags: uniqueStrings([
      ...rawOrderTags,
      ...toRecordList(orderPackage.order_tag_info_list).map((item) => asOptionalString(item.key)),
    ]),
    return_ids: returnIds,
    primary_return_id: primaryReturnId,
    aftersale_detail_urls: aftersaleDetailUrls,
    primary_aftersale_detail_url: primaryReturnId ? buildAftersaleDetailUrl(primaryReturnId) : null,
    refund_success_at: null,
    aftersale_finished_at: null,
    aftersale_type: null,
    aftersale_lookup_error: null,
  };
}

export function mergeAftersaleDetail(
  orderDetail: ParsedOrderDetail,
  aftersaleDetail: ParsedAftersaleDetail,
): ParsedOrderDetail {
  return {
    ...orderDetail,
    refund_success_at: aftersaleDetail.refund_success_at,
    aftersale_finished_at: aftersaleDetail.aftersale_finished_at,
    aftersale_type: aftersaleDetail.aftersale_type,
    aftersale_lookup_error: null,
  };
}

export function withAftersaleLookupError(
  orderDetail: ParsedOrderDetail,
  error: unknown,
): ParsedOrderDetail {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ...orderDetail,
    aftersale_lookup_error: message,
  };
}

function extractPackageId(value: string): string | null {
  const match = value.match(/\b(P\d{10,})\b/);
  return match?.[1] ?? null;
}

function extractReturnId(value: string): string | null {
  const match = value.match(/\b(R\d{10,})\b/);
  return match?.[1] ?? null;
}

export function cleanText(value: unknown): string {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLookup(value: unknown): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/[ _/]+/g, '-')
    .replace(/[，,。.;；:：()（）[\]【】"'“”‘’]+/g, '')
    .trim();
}

function buildFreshUrl(rawUrl: string): string {
  return rawUrl;
}

function buildOrderTimeRange(start: unknown, end: unknown): { startMs: number; endMs: number } {
  const defaultRange = defaultSixMonthRange();
  return {
    startMs: parseLocalDateTime(start, false) ?? defaultRange.startMs,
    endMs: parseLocalDateTime(end, true) ?? defaultRange.endMs,
  };
}

function defaultSixMonthRange(): { startMs: number; endMs: number } {
  const now = new Date();
  const start = new Date(now);
  start.setMonth(start.getMonth() - 6);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 0);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

function parseLocalDateTime(value: unknown, endOfDay: boolean): number | null {
  const text = cleanText(value);
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) {
    throw new Error(`Invalid date/time "${text}". Use YYYY-MM-DD or YYYY-MM-DD HH:mm:ss.`);
  }
  const [, y, m, d, hh, mm, ss] = match;
  const hasTime = hh !== undefined;
  const date = new Date(
    Number(y),
    Number(m) - 1,
    Number(d),
    hasTime ? Number(hh) : endOfDay ? 23 : 0,
    hasTime ? Number(mm) : endOfDay ? 59 : 0,
    hasTime ? Number(ss ?? 0) : endOfDay ? 59 : 0,
    0,
  );
  return date.getTime();
}

function toPositiveInteger(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.floor(numeric);
}

function extractMerchantCode(
  scsku: Record<string, unknown>,
  sku: Record<string, unknown>,
): string | null {
  const directCandidates = [
    scsku.merchantCode,
    scsku.merchant_code,
    scsku.sellerSkuCode,
    scsku.seller_sku_code,
    scsku.outerId,
    scsku.outer_id,
    sku.merchantCode,
    sku.merchant_code,
    sku.sellerSkuCode,
    sku.seller_sku_code,
    sku.outerId,
    sku.outer_id,
  ].map((item) => asOptionalString(item)).filter((item): item is string => Boolean(item));
  const direct = directCandidates.find((item) => !/^XHS-/i.test(item));
  if (direct) return direct;

  const textCandidates = [
    asOptionalString(scsku.specification),
    asOptionalString(scsku.skuName ?? scsku.sku_name),
    asOptionalString(scsku.name),
    asOptionalString(sku.skuSpecification ?? sku.sku_specification),
    asOptionalString(sku.skuName ?? sku.sku_name),
  ].filter((item): item is string => Boolean(item));
  for (const text of textCandidates) {
    const matches = [...text.matchAll(/[（(]([A-Za-z0-9_-]{3,})[）)]/g)];
    const match = matches.reverse().find((entry) => !/^XHS-/i.test(entry[1]));
    if (match) return match[1];
  }

  const codeCandidates = [
    asOptionalString(scsku.scskuCode ?? scsku.scsku_code),
    asOptionalString(scsku.barcode),
  ].filter((item): item is string => Boolean(item));
  return codeCandidates.find((item) => !/^XHS-/i.test(item)) ?? null;
}

function resolveExportFileName(fileUrl: string): string {
  let fileName = '';
  try {
    const url = new URL(fileUrl);
    fileName = decodeURIComponent(path.basename(url.pathname));
  } catch {
    fileName = path.basename(fileUrl);
  }
  if (!fileName || !/\.(xlsx|xls|csv)$/i.test(fileName)) {
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, '');
    fileName = `xiaohongshu-orders-${stamp}.xlsx`;
  }
  return fileName;
}

async function fetchJsonFromPage(
  page: IPage,
  pathOrUrl: string,
  options: {
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
  },
): Promise<JsonFetchResult> {
  const url = /^https?:\/\//i.test(pathOrUrl)
    ? pathOrUrl
    : `https://ark.xiaohongshu.com${pathOrUrl}`;
  const requestOptions = {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: options.headers ?? {},
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  };

  const script = `
    (async () => {
      const response = await fetch(${JSON.stringify(url)}, ${JSON.stringify(requestOptions)});
      const text = await response.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {}
      return {
        ok: response.ok,
        status: response.status,
        text,
        json,
      };
    })()
  `;

  const result = await page.evaluate(script);
  return {
    ok: Boolean(asRecord(result).ok),
    status: Number(asRecord(result).status ?? 0),
    text: String(asRecord(result).text ?? ''),
    json: asRecord(result).json ?? null,
  };
}

function extractAftersaleTimeline(lines: string[]): AftersaleTimelineEvent[] {
  const events: AftersaleTimelineEvent[] = [];

  for (let index = 0; index < lines.length - 1; index += 1) {
    const name = lines[index];
    const at = lines[index + 1];
    if (!/退款成功|退款关闭|售后完成|售后关闭|退款中/.test(name)) continue;
    if (!TIMESTAMP_RE.test(at)) continue;

    let refundAmount: string | null = null;
    for (let lookAhead = index + 2; lookAhead < Math.min(lines.length, index + 8); lookAhead += 1) {
      if (lines[lookAhead] === '退款金额') {
        refundAmount = lines[lookAhead + 1] ?? null;
        break;
      }
    }

    events.push({ name, at, refundAmount });
  }

  return events;
}

function extractHeroStatus(lines: string[]): string | null {
  const heroLine = lines.find((line) => /(退款成功|退款关闭|售后完成|处理中)/.test(line));
  if (!heroLine) return null;

  const match = heroLine.match(/(退款成功|退款关闭|售后完成|处理中)/);
  return match?.[1] ?? null;
}

function normalizeOrderStatusBucket(
  statusCode: number | null,
  afterSaleStatus: string | null,
): string {
  if (statusCode === 4) return 'paid-await-ship';
  if (statusCode === 6) return 'shipped';
  if (statusCode === 7) return 'completed';
  if (statusCode === 998 && afterSaleStatus === '售后完成') {
    return 'cancelled-aftersale-complete';
  }
  if (statusCode === 998) return 'cancelled';
  return 'other';
}

function normalizeOrderStatusBucketLabel(
  statusCode: number | null,
  afterSaleStatus: string | null,
): string {
  const bucket = normalizeOrderStatusBucket(statusCode, afterSaleStatus);
  if (bucket === 'paid-await-ship') return '付款成功 / 待发货';
  if (bucket === 'shipped') return '已发货';
  if (bucket === 'completed') return '交易完成';
  if (bucket === 'cancelled-aftersale-complete') return '已取消 / 售后完成';
  if (bucket === 'cancelled') return '已取消';
  return '其他';
}

function toLines(text: string): string[] {
  return text
    .split(LINE_SPLIT_RE)
    .map((line) => line.trim())
    .filter(Boolean);
}

function findValueAfter(lines: string[], label: string, offset = 1): string | null {
  const index = lines.findIndex((line) => line === label);
  if (index < 0) return null;

  for (let current = index + offset; current < lines.length; current += 1) {
    const line = lines[current];
    if (line && line !== label) return line;
  }

  return null;
}

function joinAddressParts(record: Record<string, unknown>): string | null {
  const parts = uniqueStrings([
    asOptionalString(record.province),
    asOptionalString(record.city),
    asOptionalString(record.district),
    asOptionalString(record.town),
    asOptionalString(record.street),
    asOptionalString(record.address),
  ]);

  return parts.length > 0 ? parts.join(' ') : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstRecord(value: unknown): Record<string, unknown> {
  return toRecordList(value)[0] ?? {};
}

function toRecordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map((item) => asRecord(item)) : [];
}

function toStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => asOptionalString(item))
        .filter((item): item is string => Boolean(item))
    : [];
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))];
}

function asOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return value === 0 ? null : String(value);
  }
  if (typeof value === 'boolean') {
    return String(value);
  }

  return null;
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}
