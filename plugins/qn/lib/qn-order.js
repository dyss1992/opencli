import { navigateQnPage } from './qn-browser.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const ORDER_PAGES = {
  unshipped: {
    label: '待发货',
    url: 'https://qn.taobao.com/home.htm/qn-order/unshipped',
    exportable: true,
    listSource: 'WAIT_CONSIGN',
  },
  shipped: {
    label: '已发货',
    url: 'https://qn.taobao.com/home.htm/qn-order/shipped',
    exportable: true,
    listSource: 'CONSIGNED',
  },
  warning: {
    label: '物流预警',
    url: 'https://qn.taobao.com/home.htm/qn-order/warning',
    exportable: true,
  },
  stockup: {
    label: '备货单',
    url: 'https://qn.taobao.com/home.htm/qn-order/stockup-order',
    exportable: true,
  },
  aftersales: {
    label: '售后管理',
    url: 'https://qn.taobao.com/home.htm/qn-order/afterSales',
    exportable: true,
  },
};

export const SORT_OPTIONS = [
  { key: 'pay-desc', label: '付款时间由近到远', aliases: ['payment-desc', 'pay-newest'], apiKey: 'PAY_TIME_NEAR_TO_FAR' },
  { key: 'pay-asc', label: '付款时间由远到近', aliases: ['payment-asc', 'pay-oldest'], apiKey: 'PAY_TIME_FAR_TO_NEAR' },
  { key: 'remaining-asc', label: '剩余发货时间由小到大', aliases: ['deadline', 'ship-deadline'], apiKey: 'CONSIGN_DUE_TIME' },
  { key: 'created-desc', label: '下单时间由近到远', aliases: ['order-desc', 'created-newest'], apiKey: 'BUY_TIME_NEAR_TO_FAR' },
  { key: 'created-asc', label: '下单时间由远到近', aliases: ['order-asc', 'created-oldest'], apiKey: 'BUY_TIME_FAR_TO_NEAR' },
  { key: 'sku-smart', label: '商家编码智能分单', aliases: ['seller-sku-smart'], apiKey: 'OUTER_ID_SMART_SORT' },
  { key: 'sku-az', label: '商家编码A-Z排序', aliases: ['seller-sku-az'], apiKey: 'OUT_SKU_A_Z' },
  { key: 'sku-za', label: '商家编码Z-A排序', aliases: ['seller-sku-za'], apiKey: 'OUT_SKU_Z_A' },
  { key: 'item-id-smart', label: '商品ID智能分单', aliases: ['item-smart'], apiKey: 'ITEM_ID_SMART_SORT' },
  { key: 'same-item-quantity-desc', label: '相同商品，数量由多到少', aliases: ['same-item-qty-desc'], apiKey: 'ITEM_ID' },
  { key: 'same-item-sku', label: '相同商品，按商家编码排序', aliases: ['same-item-code'], apiKey: 'ITEM_THEN_OUT_SKU' },
  { key: 'same-item-size-asc', label: '相同商品，区分颜色，按尺码由小到大排序', aliases: ['same-item-color-size'], apiKey: 'ITEM_THEN_COLOR_THEN_SIZE' },
  { key: 'short-name-smart', label: '商品、规格简称智能分单', aliases: ['short-name-smart-split'], apiKey: 'ITEM_ALIAS_SMART_SORT' },
  { key: 'short-name', label: '商品、规格简称排序', aliases: ['short-name-sort'], apiKey: 'CONSIGN_SKU_SORT' },
  { key: 'quantity-asc', label: '购买数量升序', aliases: ['qty-asc'], apiKey: 'ITEM_BUY_AMOUNT_ASC' },
  { key: 'quantity-desc', label: '购买数量降序', aliases: ['qty-desc'], apiKey: 'ITEM_BUY_AMOUNT_DESC' },
  { key: 'amount-asc', label: '实付金额升序', aliases: ['paid-amount-asc'], apiKey: 'ITEM_PAY_ASC' },
  { key: 'amount-desc', label: '实付金额降序', aliases: ['paid-amount-desc'], apiKey: 'ITEM_PAY_DESC' },
  { key: 'weight-asc', label: '订单重量由低到高', aliases: ['weight-low-high'], apiKey: 'CONSIGN_WEIGHT_ASC' },
  { key: 'print-desc', label: '打印时间由近到远', aliases: ['print-newest'], apiKey: 'PRINT_WAYBILL_UP' },
  { key: 'print-asc', label: '打印时间由远到近', aliases: ['print-oldest'], apiKey: 'PRINT_WAYBILL_DOWN' },
  { key: 'modified-desc', label: '修改时间由近到远', aliases: ['modify-newest'], apiKey: 'CONSIGN_MODIFY_UP' },
  { key: 'modified-asc', label: '修改时间由远到近', aliases: ['modify-oldest'], apiKey: 'CONSIGN_MODIFY_DOWN' },
  { key: 'region', label: '收货区域排序', aliases: ['receiver-region'], apiKey: 'RECEIVER_ADDRESS' },
];

export const EXPORT_FIELDS = [
  '店铺名称',
  '订单编号',
  '子订单编号',
  '买家昵称',
  '收件人姓名',
  '收件人手机号',
  '收件人省',
  '收件人市',
  '收件人区',
  '收件人详细地址',
  '下单时间',
  '快递单号',
  '商品实付金额',
  '买家留言',
  '卖家备注',
  '商品名称',
  '商品id',
  'skuid',
  '商品简称',
  '商品商家编码',
  '商品规格',
  '商品规格简称',
  '商品规格商家编码',
  '商品数量',
  '商品单价',
  '子订单状态',
  '退款状态',
  '快递单打印时间',
  '重量',
  '体积',
  '运费',
  '付款时间',
];

const DEFAULT_WAIT_SECONDS = 45;
const REFRESH_SETTLE_SECONDS = 8;
const EXCEL_EXTENSIONS = new Set(['.xlsx', '.xls']);
export const QN_SOLD_LIST_URL = 'https://qn.taobao.com/home.htm/trade-platform/tp/sold';
export const QN_ITEM_ALIAS_UPDATE_API = 'mtop.alibaba.fulfillment.printorder.item.alias.batch.update';
export const QN_SELLER_MEMO_API = 'mtop.taobao.qianniu.common.sellermemo';
export const QN_SELLER_MEMO_FLAG_IDS = {
  default: '0',
  none: '0',
  默认: '0',
  无: '0',
  blue: '4',
  蓝色: '4',
};
const SOLD_LOOKUP_API_URL = 'https://trade.taobao.com/trade/itemlist/asyncSold.htm?event_submit_do_query=1&_input_charset=utf8';
const BUYER_NICKNAME_ALLOWED_PUNCTUATION = new Set(['_', '-', '.', '。', '·', '・', '、', '丨', '|', '[', ']']);
export const QUICK_FILTERS = {
  current: null,
  all: 'ALL',
  'wait-express': 'WAIT_EXPRESS',
  'print-express': 'PRINT_EXPRESS',
  'lock-order': 'LOCK_ORDER',
  'delivery-done': 'DELIVERY_DONE',
};

export function cleanText(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodePercentEncodedBytes(source) {
  const text = String(source || '');
  const bytes = [];
  for (let index = 0; index < text.length;) {
    if (text[index] === '%' && /^[0-9a-fA-F]{2}$/.test(text.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(text.slice(index + 1, index + 3), 16));
      index += 3;
      continue;
    }
    const code = text.charCodeAt(index);
    if (code <= 0x7f) bytes.push(code);
    index += 1;
  }
  return bytes.length ? new Uint8Array(bytes) : null;
}

export function isPlausibleBuyerNickname(value) {
  const text = cleanText(value);
  if (!text || text.length < 2 || text.includes('*')) return false;
  const blockedFragments = [
    '创建时间',
    '号码保护',
    '订单号',
    '联系电话',
    '买家信息',
    '物流信息',
    '收货地址',
    '支付宝',
    '付款给买家',
    '谨慎操作',
    '买家留言',
    'Alibaba',
    'Gumo',
    'GUMO',
    'Deep Toys',
    'Youtooz',
    '茶煲星星',
    '￥',
    ':',
    '：',
  ];
  return !blockedFragments.some((fragment) => text.includes(fragment))
    && hasSupportedBuyerNicknameCharacters(text);
}

export function hasSupportedBuyerNicknameCharacters(value) {
  const text = cleanText(value);
  let hasNameCharacter = false;
  for (const char of text) {
    if (/\s/u.test(char) || BUYER_NICKNAME_ALLOWED_PUNCTUATION.has(char)) continue;
    if (/^[A-Za-z0-9]$/u.test(char)) {
      hasNameCharacter = true;
      continue;
    }
    if (/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF]/u.test(char)) {
      hasNameCharacter = true;
      continue;
    }
    return false;
  }
  return hasNameCharacter;
}

export function scoreBuyerNicknameQuality(candidate) {
  const text = cleanText(candidate);
  if (!isPlausibleBuyerNickname(text)) return -100;
  let score = 0;
  if (/[\u4e00-\u9fff]/.test(text)) score += 6;
  if (/[A-Za-z]/.test(text)) score += 2;
  if (/\d/.test(text)) score += 1;
  if (text.includes('锟')) score -= 8;
  if (/[\u0400-\u04FF]/.test(text)) score -= 6;
  if (/\uFFFD/.test(text)) score -= 8;
  return score;
}

function isSuspiciousBuyerMojibake(candidate) {
  const text = cleanText(candidate);
  if (!text) return false;
  if (text.includes('锟') || text.includes('锟斤拷') || text.includes('\uFFFD')) return true;
  if (/[\u0400-\u04FF]/.test(text)) return true;
  return /^[^\u4e00-\u9fffA-Za-z0-9_]+[A-Za-z0-9_]+$/.test(text);
}

export function preferReadableBuyerNickname(candidates) {
  const deduped = [];
  for (const candidate of candidates || []) {
    const text = cleanText(candidate);
    if (isPlausibleBuyerNickname(text) && !deduped.includes(text)) deduped.push(text);
  }
  if (deduped.length < 2) return null;
  const sorted = [...deduped].sort((left, right) => scoreBuyerNicknameQuality(right) - scoreBuyerNicknameQuality(left));
  return scoreBuyerNicknameQuality(sorted[0]) > scoreBuyerNicknameQuality(sorted[1]) ? sorted[0] : null;
}

function recoverEncodedNickname(rawEncodedValue, decodedValue) {
  const decoded = cleanText(decodedValue);
  const bytes = decodePercentEncodedBytes(rawEncodedValue);
  if (!bytes?.length) return decoded;
  let recovered = '';
  try {
    recovered = cleanText(new TextDecoder('gb18030').decode(bytes));
  } catch {
    recovered = '';
  }
  if (!isPlausibleBuyerNickname(recovered)) return decoded;
  if (!isPlausibleBuyerNickname(decoded)) return recovered;
  return scoreBuyerNicknameQuality(recovered) > scoreBuyerNicknameQuality(decoded) ? recovered : decoded;
}

function parseMemberUserId(memberUrl) {
  try {
    const url = new URL(String(memberUrl || ''), 'https://trade.taobao.com');
    const rawMatch = String(url.search || '').match(/[?&]userID=([^&#]+)/i);
    const rawUserId = rawMatch?.[1] || '';
    const userId = recoverEncodedNickname(rawUserId, url.searchParams.get('userID') || '');
    return isPlausibleBuyerNickname(userId) ? userId : null;
  } catch {
    return null;
  }
}

function parseJsonObjectMaybe(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function collectSoldMainOrders(payload) {
  const parsed = parseJsonObjectMaybe(payload);
  if (!parsed || typeof parsed !== 'object') return [];
  const resultPayload = parseJsonObjectMaybe(parsed?.data?.result) || parseJsonObjectMaybe(parsed?.result);
  const sources = [parsed, parsed.data, resultPayload, resultPayload?.data].filter(Boolean);
  const orders = [];
  for (const source of sources) {
    if (Array.isArray(source?.mainOrders)) orders.push(...source.mainOrders);
  }
  return orders;
}

function orderMatchesId(order, orderId) {
  const candidates = [
    order?.id,
    order?.orderId,
    order?.mainBizOrderId,
    order?.bizOrderId,
    order?.orderInfo?.id,
    order?.orderInfo?.orderId,
  ].map((value) => cleanText(value));
  return candidates.includes(cleanText(orderId));
}

export function pickQnSoldListNicknameFromPayload(payload, orderId) {
  const matchedOrder = collectSoldMainOrders(payload).find((order) => orderMatchesId(order, orderId));
  if (!matchedOrder) return null;

  const memberUserId = parseMemberUserId(matchedOrder?.buyer?.memberUrl);
  const buyerNick = cleanText(matchedOrder?.buyer?.nick || '');
  return preferReadableBuyerNickname([memberUserId, buyerNick])
    || memberUserId
    || (isPlausibleBuyerNickname(buyerNick) ? buyerNick : null);
}

export function inspectQnSoldListNicknameFromPayload(payload, orderId) {
  const matchedOrder = collectSoldMainOrders(payload).find((order) => orderMatchesId(order, orderId));
  if (!matchedOrder) return { matched: false, nickname: null, source: 'not-found' };

  const nickname = pickQnSoldListNicknameFromPayload(payload, orderId);
  if (nickname) return { matched: true, nickname, source: 'sold-list-nickname' };

  const maskedNick = cleanText(matchedOrder?.buyer?.nick || '');
  return {
    matched: true,
    nickname: null,
    maskedNick,
    source: maskedNick ? 'sold-list-masked-nickname' : 'sold-list-nickname-hidden',
  };
}

export function buildQnBuyerOnlyRow(orderId, soldLookup = {}) {
  const nickname = cleanText(soldLookup.nickname);
  const candidates = nickname ? [nickname] : [];
  const source = cleanText(soldLookup.source);
  const isDetailFallback = source === 'detail-page-nickname';
  const maskedNick = cleanText(soldLookup.maskedNick);

  return {
    order_id: cleanText(orderId),
    display_nick: nickname,
    nickname_source: nickname ? (isDetailFallback ? 'detail-page' : 'sold-list') : '',
    minimum_userscript_version: '',
    userscript_version: '',
    userscript_version_source: 'not-checked',
    userscript_version_ok: '',
    order_status: '',
    order_status_secondary: '',
    item_statuses: '',
    payment_method: '',
    created_time: '',
    paid_time: '',
    deal_time: '',
    cancel_reason: '',
    shipping_method: '',
    logistics_company: '',
    tracking_number: '',
    address_label: '',
    address_line: '',
    masked_address_line: '',
    recipient_decrypt_status: 'not-requested',
    recipient_decrypt_ret: [],
    recipient_decrypt_error: '',
    recipient_name: '',
    recipient_phone: '',
    recipient_mobile: '',
    recipient_secret_no: '',
    recipient_full_address: '',
    recipient_address_detail: '',
    recipient_buyer_nick: '',
    recipient_state: '',
    recipient_city: '',
    recipient_district: '',
    recipient_town: '',
    masked_buyer_nick: '',
    masked_buyer_phone: '',
    meta_nick: nickname,
    meta_nick_source: nickname ? source : '',
    current_nick: isDetailFallback ? nickname : '',
    address_phone: '',
    detail_fetch_nick: isDetailFallback ? nickname : '',
    detail_fetch_nick_candidates: isDetailFallback ? candidates : [],
    detail_fetch_phone: '',
    detail_fetch_phone_candidates: [],
    detail_fetch_phone_snippets: [],
    buyer_text: '',
    list_page_nick: isDetailFallback ? '' : nickname,
    detail_page_nick: isDetailFallback ? nickname : '',
    buyer_phone: '',
    buyer_lines: [maskedNick, ...candidates].filter(Boolean),
    detail_page_wangwang_candidates: isDetailFallback ? candidates : [],
    wangwang_candidates: candidates,
    resource_urls: [],
    debug_fetches: Array.isArray(soldLookup.debugFetches) ? soldLookup.debugFetches : [],
    first_phone: '',
    second_phone: '',
    third_phone: '',
    final_phone: '',
    is_virtual_phone: false,
    extension: '',
    dial_string: '',
    source: nickname ? (isDetailFallback ? 'detail-page-nickname' : 'sold-list-nickname') : (source || 'not-found'),
    list_lookup_source: cleanText(soldLookup.listLookupSource),
    list_lookup_masked_nick: maskedNick,
    refund_status: '',
    refund_id: '',
    refund_detail_url: '',
    refund_close_time: '',
    detail_url: '',
    read_mode: isDetailFallback ? 'buyer-list-fallback' : 'buyer-list',
  };
}

function buildQnDetailNicknameFetchUrls(orderId) {
  const normalizedOrderId = resolveQnOrderId(orderId);
  const values = [
    [0, false],
    [1, false],
    [0, 0],
    [1, 0],
  ];
  return values.map(([sifg, hideNick]) => {
    const url = new URL('https://trade.taobao.com/trade/detail/trade_order_detail_qian_niu.htm');
    url.searchParams.set('bizOrderId', normalizedOrderId);
    url.searchParams.set('sifg', String(sifg));
    url.searchParams.set('isQnNew', 'true');
    url.searchParams.set('isHideNick', String(hideNick));
    return url.toString();
  });
}

export async function lookupQnDetailBuyerNickname(page, orderId, options = {}) {
  if (!page) throw new Error('Browser page required');
  const normalizedOrderId = resolveQnOrderId(orderId);
  const urls = buildQnDetailNicknameFetchUrls(normalizedOrderId);
  const maskedNick = cleanText(options.maskedNick);
  const listLookupSource = cleanText(options.listLookupSource);
  return await page.evaluate(`(async () => {
    const urls = ${JSON.stringify(urls)};
    const maskedNick = ${JSON.stringify(maskedNick)};
    const listLookupSource = ${JSON.stringify(listLookupSource)};
    const collapse = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const blockedFragments = [
      '创建时间',
      '号码保护',
      '订单号',
      '联系电话',
      '买家信息',
      '物流信息',
      '收货地址',
      '支付宝',
      '付款给买家',
      '谨慎操作',
      '买家留言',
      'Alibaba',
      'Gumo',
      'GUMO',
      'Deep Toys',
      'Youtooz',
      '茶煲星星',
      '￥',
      ':',
      '：',
    ];
    const allowedNicknamePunctuation = new Set(['_', '-', '.', '。', '·', '・', '、', '丨', '|', '[', ']']);
    const hasSupportedNicknameCharacters = (value) => {
      const text = collapse(value);
      let hasNameCharacter = false;
      for (const char of text) {
        if (/\\s/u.test(char) || allowedNicknamePunctuation.has(char)) continue;
        if (/^[A-Za-z0-9]$/u.test(char)) {
          hasNameCharacter = true;
          continue;
        }
        if (/[\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\u3040-\\u30FF]/u.test(char)) {
          hasNameCharacter = true;
          continue;
        }
        return false;
      }
      return hasNameCharacter;
    };
    const isPlausibleNickname = (value) => {
      const text = collapse(value);
      return Boolean(
        text
        && text.length >= 2
        && !text.includes('*')
        && !text.includes('锟')
        && !text.includes('\\uFFFD')
        && !/[\\u0400-\\u04FF]/.test(text)
        && hasSupportedNicknameCharacters(text)
        && !blockedFragments.some((fragment) => text.includes(fragment))
      );
    };
    const scoreNicknameQuality = (candidate) => {
      const text = collapse(candidate);
      if (!isPlausibleNickname(text)) return -100;
      let score = 0;
      if (/[\\u4e00-\\u9fff]/.test(text)) score += 6;
      if (/[A-Za-z]/.test(text)) score += 2;
      if (/\\d/.test(text)) score += 1;
      if (text.includes('锟')) score -= 8;
      if (/[\\u0400-\\u04FF]/.test(text)) score -= 6;
      if (/\\uFFFD/.test(text)) score -= 8;
      return score;
    };
    const dedupeOrdered = (values) => {
      const result = [];
      for (const value of values || []) {
        const text = collapse(value);
        if (isPlausibleNickname(text) && !result.includes(text)) result.push(text);
      }
      return result;
    };
    const decodeEscapedText = (value) => {
      const source = String(value || '');
      if (!source.includes('\\\\u') && !source.includes('\\\\x')) return source;
      try {
        return JSON.parse('"' + source.replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"') + '"');
      } catch {
        return source;
      }
    };
    const extractNickCandidatesFromText = (text) => {
      const source = String(text || '');
      const candidates = [];
      const patterns = [
        /nick\\\\":\\\\"([^"\\\\]+(?:\\\\.[^"\\\\]*)*)\\\\"/g,
        /"nick":"([^"\\\\]+(?:\\\\.[^"\\\\]*)*)"/g,
      ];
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(source)) !== null) {
          const candidate = collapse(decodeEscapedText(match[1] || ''));
          if (isPlausibleNickname(candidate) && !candidates.includes(candidate)) candidates.push(candidate);
        }
      }
      return candidates;
    };
    const extractBuyerNickFromDetailText = (text) => {
      const source = String(text || '');
      const patterns = [
        /"buyer"\\s*:\\s*\\{[\\s\\S]{0,400}?"nick"\\s*:\\s*"([^"\\\\]+(?:\\\\.[^"\\\\]*)*)"/,
        /buyer\\\\":\\\\{[\\\\s\\\\S]{0,400}?nick\\\\":\\\\"([^"\\\\]+(?:\\\\.[^"\\\\]*)*)\\\\"/,
      ];
      for (const pattern of patterns) {
        const match = pattern.exec(source);
        const candidate = collapse(decodeEscapedText(match?.[1] || ''));
        if (isPlausibleNickname(candidate)) return candidate;
      }
      return null;
    };
    const decodeResponseTexts = async (response) => {
      const buffer = await response.arrayBuffer();
      const texts = [];
      for (const encoding of ['utf-8', 'gb18030']) {
        try {
          const text = new TextDecoder(encoding).decode(buffer);
          if (text && !texts.includes(text)) texts.push(text);
        } catch {
          // Ignore unsupported browser decoders.
        }
      }
      return texts;
    };
    const debugFetches = await Promise.all(urls.map(async (url) => {
      try {
        const response = await fetch(url, { credentials: 'include' });
        const texts = await decodeResponseTexts(response);
        const buyerNickCandidate = texts
          .map((text) => extractBuyerNickFromDetailText(text))
          .find(Boolean) || null;
        const nicknameCandidates = dedupeOrdered(texts.flatMap((text) => extractNickCandidatesFromText(text))).slice(0, 20);
        return {
          url,
          ok: response.ok,
          status: response.status,
          finalUrl: response.url || null,
          buyerNickCandidate,
          nicknameCandidates,
        };
      } catch (error) {
        return {
          url,
          ok: false,
          status: null,
          finalUrl: null,
          buyerNickCandidate: null,
          nicknameCandidates: [],
          error: String(error),
        };
      }
    }));
    const buyerCandidates = dedupeOrdered(debugFetches.map((entry) => entry.buyerNickCandidate));
    const maskedPrefix = String(maskedNick || '').match(/^(.+?)\\*+$/)?.[1] || '';
    const prefixMatch = maskedPrefix ? buyerCandidates.find((candidate) => candidate.startsWith(maskedPrefix)) : '';
    const allCandidates = dedupeOrdered(debugFetches.flatMap((entry) => [entry.buyerNickCandidate, ...(entry.nicknameCandidates || [])]));
    const candidateFrequency = new Map();
    for (const fetchEntry of debugFetches) {
      const set = new Set(dedupeOrdered([fetchEntry.buyerNickCandidate, ...(fetchEntry.nicknameCandidates || [])]));
      for (const candidate of set) candidateFrequency.set(candidate, (candidateFrequency.get(candidate) || 0) + 1);
    }
    const frequentCandidates = allCandidates.filter((candidate) => (candidateFrequency.get(candidate) || 0) > 1);
    const nickname = prefixMatch ||
      (buyerCandidates.length === 1 ? buyerCandidates[0] : '') ||
      frequentCandidates.sort((left, right) => scoreNicknameQuality(right) - scoreNicknameQuality(left))[0] ||
      allCandidates.sort((left, right) => scoreNicknameQuality(right) - scoreNicknameQuality(left))[0] ||
      '';
    if (!nickname) {
      return {
        matched: false,
        nickname: null,
        maskedNick,
        source: 'detail-page-not-found',
        listLookupSource,
        debugFetches,
      };
    }
    return {
      matched: true,
      nickname,
      source: 'detail-page-nickname',
      maskedNick,
      listLookupSource,
      debugFetches,
    };
  })()`);
}

export function buildQnSoldLatestLookupBody(orderId) {
  const normalizedOrderId = cleanText(orderId);
  return {
    unionSearch: normalizedOrderId,
    orderStatus: 'ALL',
    pageSize: '15',
    dateEnd: '0',
    dateBegin: '0',
    action: 'itemlist/SoldQueryAction',
    isQnNew: 'true',
    pageNum: '1',
    queryOrder: 'desc',
    tabCode: 'latest3Months',
    queryMore: 'true',
    buyerNick: '',
    sifg: '1',
    bizOrderId: normalizedOrderId,
    orderId: normalizedOrderId,
  };
}

export function buildQnSoldHistoricalLookupBody(orderId) {
  const normalizedOrderId = cleanText(orderId);
  return {
    action: 'itemlist/SoldHisQueryAction',
    orderId: normalizedOrderId,
    buyerNick: '',
    pageNum: '1',
    pageSize: '15',
    dateBegin: '0',
    dateEnd: '0',
    payDateBegin: '0',
    payDateEnd: '0',
    endTimeBegin: '0',
    endTimeEnd: '0',
    queryOrder: 'desc',
    queryOrderType: '',
    queryMore: 'false',
    sifg: '1',
    tradeTag: '0',
    holdStatus: '0',
    sellerMemo: '0',
    useCheckcode: 'false',
    useOrderInfo: 'false',
    isQnNew: 'true',
    auctionType: '0',
    close: '0',
    rxAuditFlag: '0',
    rxElectronicAllFlag: '0',
    rxElectronicAuditFlag: '0',
    rxHasSendFlag: '0',
    rxOldFlag: '0',
    rxSendFlag: '0',
    rxSuccessflag: '0',
    rxWaitSendflag: '0',
    unionSearchPageNum: '0',
    unionSearchTotalNum: '0',
    tabCode: 'before3Months',
  };
}

function normalizeLookup(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[ _/]+/g, '-')
    .replace(/[，,。.;；:：()（）[\]【】"'“”‘’]+/g, '')
    .trim();
}

export function resolveOrderPage(rawPage = 'unshipped') {
  const key = normalizeLookup(rawPage || 'unshipped');
  const page = ORDER_PAGES[key];
  if (!page) {
    throw new Error(`Unknown order page "${rawPage}". Available: ${Object.keys(ORDER_PAGES).join(', ')}`);
  }
  return { key, ...page };
}

export function resolveOrderListPage(rawPage = 'unshipped') {
  const page = resolveOrderPage(rawPage);
  if (!page.listSource) {
    throw new Error(`Order page "${page.key}" does not expose a direct list source yet.`);
  }
  return page;
}

export function buildFreshOrderPageUrl(orderPageUrl) {
  return orderPageUrl;
}

export function resolveSortOption(rawSort) {
  const value = cleanText(rawSort);
  if (!value) return null;
  const normalized = normalizeLookup(value);
  const option = SORT_OPTIONS.find((entry) => {
    return normalizeLookup(entry.key) === normalized
      || normalizeLookup(entry.label) === normalized
      || (entry.aliases || []).some((alias) => normalizeLookup(alias) === normalized);
  });
  if (!option) {
    throw new Error(`Unknown sort "${rawSort}". Run "opencli qn order-sort --list" to see available sort keys.`);
  }
  return option;
}

export function rowsForSortOptions(status = 'available') {
  return SORT_OPTIONS.map((option) => ({
    key: option.key,
    label: option.label,
    status,
    aliases: (option.aliases || []).join(','),
  }));
}

export function shouldRefreshBeforeExport(rawValue = true) {
  if (rawValue === false) return false;
  const value = cleanText(rawValue).toLowerCase();
  if (!value) return true;
  return !['false', '0', 'no', 'off'].includes(value);
}

export function shouldRefreshBeforeRead(rawValue = true) {
  return shouldRefreshBeforeExport(rawValue);
}

export function resolveQuickFilter(rawFilter = 'all') {
  const key = normalizeLookup(rawFilter || 'all');
  if (!Object.hasOwn(QUICK_FILTERS, key)) {
    throw new Error(`Unknown quick filter "${rawFilter}". Available: ${Object.keys(QUICK_FILTERS).join(', ')}`);
  }
  return { key, apiKey: QUICK_FILTERS[key] };
}

export function resolveQnOrderId(target) {
  const value = cleanText(target);
  if (!value) {
    throw new Error('QianNiu order id or detail URL is required.');
  }
  if (/^\d{10,}$/.test(value)) return value;
  try {
    const url = new URL(value);
    const fromParams = url.searchParams.get('bizOrderId') || url.searchParams.get('tradeId');
    if (fromParams && /^\d{10,}$/.test(fromParams)) return fromParams;
  } catch {
    // Fall back to scanning below.
  }
  const match = value.match(/\d{10,}/);
  if (match) return match[0];
  throw new Error(`Could not resolve QianNiu order id from "${target}".`);
}

export function buildQnOrderDetailUrl(target) {
  const orderId = resolveQnOrderId(target);
  const url = new URL('https://qn.taobao.com/home.htm/trade-platform/tp/detail');
  url.searchParams.set('bizOrderId', orderId);
  return url.toString();
}

export function buildQnConsignDetailUrl(target) {
  const orderId = resolveQnOrderId(target);
  const url = new URL('https://qn.taobao.com/home.htm/consign-detail/');
  url.searchParams.set('tradeId', orderId);
  return url.toString();
}

function rawText(value) {
  return String(value ?? '').replace(/\r/g, '');
}

function normalizeExtractedValue(value) {
  const normalized = cleanText(value).replace(/^[:：]/, '').trim();
  return normalized && !['-', '—', '--'].includes(normalized) ? normalized : '';
}

function extractLine(text, label) {
  const source = rawText(text);
  const escaped = label.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
  const match =
    source.match(new RegExp(`${escaped}[:：]\\s*([^\\n]+)`)) ||
    source.match(new RegExp(`${escaped}\\s*([^\\n]+)`));
  return normalizeExtractedValue(match?.[1] || '');
}

export function normalizeQnTerminalStatus(rawStatus) {
  const status = cleanText(rawStatus);
  if (!status) return '';
  if (/(交易成功|交易完成|已完成|买家已签收|卖家已收到货款)/.test(status)) return '已完成';
  if (/(交易关闭|已关闭|已取消|买家已退款|退款成功|订单关闭)/.test(status)) return '已关闭';
  return '';
}

function extractOrderStatus(text) {
  const direct = extractLine(text, '订单状态');
  if (direct) return direct;
  const statusMatch = rawText(text).match(/(交易成功|交易完成|已完成|交易关闭|已关闭|已取消|退款成功|订单关闭)/);
  return normalizeExtractedValue(statusMatch?.[1] || '');
}

function firstExtractedLine(text, labels) {
  for (const label of labels) {
    const value = extractLine(text, label);
    if (value) return value;
  }
  return '';
}

function hasExpectedRoute(href, routePart) {
  try {
    const url = new URL(cleanText(href));
    return url.href.includes(routePart);
  } catch {
    return false;
  }
}

function looksLikeQnOrderDetail(item, orderId) {
  const text = rawText(item?.bodyText);
  if (!hasExpectedRoute(item?.href, '/trade-platform/tp/detail')
    && !hasExpectedRoute(item?.href, '/trade/detail/trade_order_detail.htm')) return false;
  if (!text.includes(orderId)) return false;
  return text.includes('订单状态') || text.includes('成交时间') || text.includes('付款时间');
}

function looksLikeQnConsignDetail(item, orderId) {
  const text = rawText(item?.bodyText);
  if (!hasExpectedRoute(item?.href, '/consign-detail')) return false;
  if (!text.includes(orderId)) return false;
  return text.includes('运单号') || text.includes('物流单号') || text.includes('快递单号');
}

function isAbsoluteDateTimeText(value) {
  const text = cleanText(value);
  if (!text) return false;
  return (
    /^\d{4}-\d{1,2}-\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(text) ||
    /^\d{4}\/\d{1,2}\/\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(text)
  );
}

export function parseQnOrderDetailText(text, orderId = '') {
  const raw = rawText(text);
  const rawOrderStatus = extractOrderStatus(raw);
  return {
    order_id: cleanText(orderId),
    raw_order_status: rawOrderStatus,
    terminal_status: normalizeQnTerminalStatus(rawOrderStatus),
    created_time: extractLine(raw, '创建时间'),
    paid_time: extractLine(raw, '付款时间'),
    deal_time: extractLine(raw, '成交时间'),
    cancel_reason: extractLine(raw, '取消原因'),
  };
}

function soldListItemStatus(subOrder) {
  const operationTexts = (subOrder?.operations || [])
    .map((operation) => cleanText(operation?.text))
    .filter(Boolean);
  const statuses = operationTexts.filter((text) => (
    text.includes('未发货')
    || text.includes('等待发货')
    || text.includes('已发货')
    || text.includes('交易成功')
    || text.includes('已确认收货')
    || text === '已完成'
    || text.includes('交易关闭')
    || text.includes('退款成功')
  ));
  return statuses.find((text) => text.includes('退款成功') || text.includes('交易关闭'))
    || statuses.find((text) => text.includes('未发货') || text.includes('等待发货'))
    || statuses[0] || '';
}

function soldListMerchantCode(itemInfo) {
  const extras = Array.isArray(itemInfo?.extra) ? itemInfo.extra : [];
  const named = extras.find((entry) => {
    const name = cleanText(entry?.name);
    return name.includes('商家编码') || name.includes('商家編碼');
  });
  if (named) return cleanText(named.value);
  return '';
}

function itemStatusIndicatesShipped(rawStatus) {
  const status = cleanText(rawStatus);
  if (!status) return false;
  if (status.includes('未发货') || status.includes('等待发货')) return false;
  return (
    status.includes('已发货')
    || status === '已完成'
    || status.includes('已确认收货')
    || status.includes('交易成功')
  );
}

export function pickQnSoldListItemsFromPayload(payload, orderId) {
  const matchedOrder = collectSoldMainOrders(payload).find((order) => orderMatchesId(order, orderId));
  if (!matchedOrder) return [];
  const subOrders = Array.isArray(matchedOrder?.subOrders) ? matchedOrder.subOrders : [];
  return subOrders.map((subOrder) => {
    const itemInfo = subOrder?.itemInfo || {};
    const rawStatus = soldListItemStatus(subOrder);
    const skuId = cleanText(itemInfo?.skuId || itemInfo?.skuIdStr || itemInfo?.sku_id);
    const scalar = value => typeof value === 'string' || typeof value === 'number' ? cleanText(value).slice(0, 80) : '';
    const nativeStates = Object.fromEntries(Object.entries({
      status: subOrder?.status, tradeStatus: subOrder?.tradeStatus, orderStatus: subOrder?.orderStatus,
      statusInfoStatus: subOrder?.statusInfo?.status,
    }).map(([key, value]) => [key, scalar(value)]).filter(([, value]) => value));
    const refundStates = Object.fromEntries(Object.entries({
      refundStatus: subOrder?.refundStatus, refundInfoStatus: subOrder?.refundInfo?.status,
      refundInfoRefundStatus: subOrder?.refundInfo?.refundStatus,
    }).map(([key, value]) => [key, scalar(value)]).filter(([, value]) => value));
    const refundUnverified = Object.values(refundStates).some(value => value !== 'NO_REFUND');
    const nativeConflict = Object.values(nativeStates).some(value =>
      !['TRADE_FINISHED', '交易成功', '已完成'].includes(value))
      && ['交易成功', '已完成', '已确认收货'].includes(rawStatus);
    return {
      sub_order_id: cleanText(subOrder?.idStr || itemInfo?.subId || subOrder?.id),
      spec_id: skuId === '0' ? '' : skuId,
      merchant_code: soldListMerchantCode(itemInfo),
      title: cleanText(itemInfo?.title),
      raw_status: rawStatus,
      native_status_fields: nativeStates,
      refund_status_fields: refundStates,
      evidence_error: refundUnverified ? 'item_refund_state_unverified' : nativeConflict ? 'item_native_status_conflict' : '',
      shipped: itemStatusIndicatesShipped(rawStatus),
      quantity: Number(subOrder?.quantity || 0),
      unit_price: cleanText(subOrder?.priceInfo?.realTotal),
    };
  }).filter((item) => item.sub_order_id || item.merchant_code || item.title);
}

function mergeQnPartialShipmentItems(domItems = [], packages = [], soldItems = []) {
  const domBySubOrder = new Map(
    domItems
      .filter((item) => cleanText(item?.sub_order_id))
      .map((item) => [cleanText(item.sub_order_id), item]),
  );
  const packageBySubOrder = new Map();
  for (const packageItem of packages || []) {
    for (const subOrderId of packageItem?.sub_order_ids || []) {
      if (cleanText(subOrderId)) packageBySubOrder.set(cleanText(subOrderId), packageItem);
    }
  }
  const sourceItems = soldItems.length ? soldItems : domItems;
  return sourceItems.map((item) => {
    const subOrderId = cleanText(item?.sub_order_id);
    const domItem = domBySubOrder.get(subOrderId) || {};
    const packageItem = packageBySubOrder.get(subOrderId) || {};
    const rawStatus = cleanText(item?.raw_status || domItem?.raw_status);
    const packageTracking = cleanText(packageItem?.tracking_number);
    const detailStatus = cleanText(domItem?.raw_status);
    const statusKind = (text) => {
      if (/退款成功|交易关闭/.test(text)) return 'closed';
      if (/未发货|等待发货/.test(text)) return 'unshipped';
      if (/交易成功|已确认收货|已完成/.test(text)) return 'completed';
      if (/已发货/.test(text)) return 'shipped';
      return '';
    };
    const soldKind = statusKind(rawStatus);
    const detailKind = statusKind(detailStatus);
    const evidenceErrors = cleanText(item?.evidence_error) ? [cleanText(item.evidence_error)] : [];
    if (soldKind && detailKind && soldKind !== detailKind) evidenceErrors.push('item_status_conflict');
    if (domItems.filter(row => cleanText(row?.sub_order_id) === subOrderId && subOrderId).length > 1) {
      evidenceErrors.push('duplicate_detail_item');
    }
    if ((packages || []).filter(row => (row?.sub_order_ids || []).map(cleanText).includes(subOrderId) && subOrderId).length > 1) {
      evidenceErrors.push('multiple_item_packages');
    }
    return {
      sub_order_id: subOrderId,
      spec_id: cleanText(item?.spec_id),
      merchant_code: cleanText(item?.merchant_code),
      title: cleanText(item?.title || domItem?.title),
      raw_status: rawStatus,
      detail_raw_status: detailStatus,
      evidence_error: evidenceErrors.join(','),
      native_status_fields: item?.native_status_fields || {},
      refund_status_fields: item?.refund_status_fields || {},
      shipped: itemStatusIndicatesShipped(rawStatus) || Boolean(packageTracking),
      tracking_number: packageTracking,
      logistics_company: cleanText(packageItem?.logistics_company),
      shipped_at: cleanText(packageItem?.shipped_at),
      quantity: Number(item?.quantity || domItem?.quantity || 0),
      unit_price: cleanText(item?.unit_price || domItem?.unit_price),
    };
  });
}

async function lookupQnSoldListItems(page, orderId, requestSpacingSeconds = 0, phase = '', readDeadlineMs = 0) {
  if (!['', 'sold_latest', 'sold_historical'].includes(phase)) throw new Error('invalid_qn_evidence_phase');
  const latestLookupBody = buildQnSoldLatestLookupBody(orderId);
  const historicalLookupBody = buildQnSoldHistoricalLookupBody(orderId);
  const evaluate = typeof page.evaluateOnce === 'function' ? page.evaluateOnce.bind(page) : page.evaluate.bind(page);
  const result = await evaluate(`(async () => {
    const orderId = ${JSON.stringify(orderId)};
    const apiUrl = ${JSON.stringify(SOLD_LOOKUP_API_URL)};
    const phases = [
      { name: 'latest_exact', body: ${JSON.stringify(latestLookupBody)} },
      { name: 'historical_exact', body: ${JSON.stringify(historicalLookupBody)} },
    ].filter(item => !${JSON.stringify(phase)} || item.name === (${JSON.stringify(phase)} === 'sold_latest' ? 'latest_exact' : 'historical_exact'));
    const strictSinglePhase = Boolean(${JSON.stringify(phase)});
    const readDeadlineMs = ${JSON.stringify(readDeadlineMs)};
    const deferred = (reason = 'phase_budget_deferred') => ({mainOrders: [], request_diagnostics: [], deferred: true,
      fetch_started: false, read_deadline_ms: readDeadlineMs, defer_reason: reason});
    if (strictSinglePhase && (!Number.isSafeInteger(readDeadlineMs) || readDeadlineMs <= 0
        || readDeadlineMs - Date.now() > 90000)) throw new Error('invalid_qn_read_deadline');
    if (strictSinglePhase && Date.now() + 20000 + 45000 > readDeadlineMs) return deferred();
    const requireCurrentSession = () => {
      const bodyText = document.body?.innerText || '';
      const current = new URL(location.href);
      if (/login/i.test(location.href) || /扫码登录|手机验证码登录/.test(bodyText)) {
        const error = new Error('QianNiu login session expired; stopped this read.');
        error.code = 'SESSION_EXPIRED'; throw error;
      }
      if (current.protocol !== 'https:' || !['qn.taobao.com', 'trade.taobao.com'].includes(current.hostname)) {
        return false;
      }
      return true;
    };
    if (strictSinglePhase && !requireCurrentSession()) return deferred('context_unavailable');
    const requireNoVerification = (text = '') => {
      const frames = document.querySelectorAll?.('iframe[src*="/_____tmd_____/punish"]') || [];
      const visible = Array.from(frames).some(frame => {
        const rect = frame.getBoundingClientRect();
        const style = getComputedStyle(frame);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      });
      if (visible || /FAIL_SYS_USER_VALIDATE|\\/_____tmd_____\\/punish/i.test(text)) {
        const error = new Error('千牛需要人工验证（FAIL_SYS_USER_VALIDATE），已停止读取。');
        error.code = 'MANUAL_VERIFICATION';
        throw error;
      }
    };
    const encodeBody = (body) => Object.entries(body)
      .map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(String(value ?? '')))
      .join('&');
    const requireSuccessfulPhasePayload = (parsed, nested) => {
      if (!strictSinglePhase) return;
      const records = [parsed, parsed?.data, nested, nested?.data].filter(value => value && typeof value === 'object');
      const meta = records.flatMap(value => [value.message, value.msg, value.error, value.errorMsg, value.code,
        ...(Array.isArray(value.ret) ? value.ret : value.ret ? [value.ret] : [])])
        .filter(value => typeof value === 'string').join(' ');
      const reject = (code, message) => { const error = new Error(message); error.code = code; throw error; };
      if (/FAIL_SYS_USER_VALIDATE|滑块|验证码|安全验证|人机验证|MANUAL_VERIFICATION|captcha/i.test(meta)) {
        reject('MANUAL_VERIFICATION', '千牛需要人工验证（MANUAL_VERIFICATION），已停止读取。');
      }
      if (/FAIL_SYS_SESSION_EXPIRED|FAIL_SYS_LOGIN|SESSION_EXPIRED|Session过期|会话过期|登录失效|请先登录|未登录|重新登录|login/i.test(meta)) {
        reject('SESSION_EXPIRED', 'QianNiu login session expired; stopped this read.');
      }
      const failed = records.some(value => value.success === false || value.success === 'false'
        || value.error === true || (typeof value.error === 'string' && value.error)
        || (Array.isArray(value.ret) && value.ret.some(item => !/^SUCCESS(?::|$)/i.test(String(item)))));
      if (failed) reject('PHASE_BUSINESS_FAILURE', 'QianNiu phase business response rejected; no evidence saved.');
      if (![nested, nested?.data].some(value => Array.isArray(value?.mainOrders))) {
        reject('PHASE_BUSINESS_FAILURE', 'QianNiu phase response schema unverified; no evidence saved.');
      }
    };
    const parsePayloads = async (response) => {
      const buffer = await response.arrayBuffer();
      const output = [];
      let phaseFailure = null;
      for (const encoding of ['gb18030', 'utf-8']) {
        let text;
        try { text = new TextDecoder(encoding).decode(buffer); } catch { continue; }
        requireNoVerification(text);
        try {
          const parsed = JSON.parse(text);
          const nested = typeof parsed?.data?.result === 'string'
            ? JSON.parse(parsed.data.result)
            : (parsed?.data?.result || parsed?.result || parsed);
          requireSuccessfulPhasePayload(parsed, nested);
          output.push(nested);
        } catch (error) {
          if (strictSinglePhase && ['MANUAL_VERIFICATION', 'SESSION_EXPIRED'].includes(error?.code)) throw error;
          if (strictSinglePhase && error?.code === 'PHASE_BUSINESS_FAILURE') phaseFailure = error;
          // Ignore unsupported encodings and malformed platform responses.
        }
      }
      if (!output.length && phaseFailure) throw phaseFailure;
      if (!output.length) throw new Error('千牛商品明细响应无法读取；未继续查询。');
      return output;
    };
    const collectOrders = (payload) => {
      const sources = [payload, payload?.data].filter(Boolean);
      return sources.flatMap((source) => Array.isArray(source?.mainOrders) ? source.mainOrders : []);
    };
    const matches = (order) => [
      order?.id,
      order?.orderId,
      order?.mainBizOrderId,
      order?.bizOrderId,
      order?.orderInfo?.id,
      order?.orderInfo?.orderId,
    ].map((value) => String(value || '').trim()).includes(orderId);
    const readability = (order) => {
      const text = JSON.stringify(order || {});
      const positives = ['商家编码', '未发货', '已发货', '交易成功', '已确认收货']
        .reduce((count, marker) => count + (text.includes(marker) ? 10 : 0), 0);
      return positives - (text.match(/[�锟]/g) || []).length;
    };
    const diagnostics = [];
    for (const { name, body } of phases) {
      if (strictSinglePhase && Date.now() + 20000 + 45000 > readDeadlineMs) return deferred();
      if (${JSON.stringify(requestSpacingSeconds)} > 0) {
        await new Promise(resolve => setTimeout(resolve, ${JSON.stringify(requestSpacingSeconds)} * 1000));
      }
      requireNoVerification();
      if (strictSinglePhase && !requireCurrentSession()) return deferred('context_unavailable');
      if (strictSinglePhase && Date.now() + 45000 > readDeadlineMs) return deferred();
      const startedAt = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), strictSinglePhase ? Math.min(45000, Math.max(0, readDeadlineMs - Date.now())) : 45000);
      let response, payloads;
      try {
        response = await fetch(apiUrl, {
        method: 'POST',
        redirect: strictSinglePhase ? 'error' : 'follow',
        credentials: 'include',
        headers: {'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'},
        body: encodeBody(body),
        signal: controller.signal,
        });
        if (response.ok !== false) payloads = await parsePayloads(response);
      } finally {
        clearTimeout(timer);
      }
      diagnostics.push({ phase: name,
        started_at_ms: startedAt, finished_at_ms: Date.now(), http_ok: response.ok !== false });
      if (strictSinglePhase && /login/i.test(response.url || '')) throw new Error('QianNiu redirected to login');
      if (response.ok === false) throw new Error('千牛商品明细请求未成功；未继续查询。');
      const matched = payloads
        .flatMap(collectOrders)
        .filter(matches)
        .sort((left, right) => readability(right) - readability(left));
      if (matched.length) return { mainOrders: [matched[0]], request_diagnostics: diagnostics };
    }
    return { mainOrders: [], request_diagnostics: diagnostics };
  })()`);
  return { items: pickQnSoldListItemsFromPayload(result, orderId), diagnostics: result.request_diagnostics || [], deferred: result.deferred === true, defer_reason: result.defer_reason };
}

// This command exposes one explicit read request; checkpoints never replace fresh write evidence.
export async function readQnHistoricalEvidencePhase(page, target, phase, readDeadlineMs) {
  if (!['sold_latest', 'sold_historical'].includes(phase)) throw new Error('invalid_qn_evidence_phase');
  if (typeof page?.evaluateOnce !== 'function') throw new Error('non_replaying_evaluation_required');
  if (!/^[0-9]{10,32}$/.test(String(target))) throw new Error('exact_qn_order_id_required');
  readDeadlineMs = Number(readDeadlineMs);
  if (!Number.isSafeInteger(readDeadlineMs) || readDeadlineMs <= 0) throw new Error('invalid_qn_read_deadline');
  const orderId = resolveQnOrderId(target);
  const lookup = await lookupQnSoldListItems(page, orderId, 20, phase, readDeadlineMs);
  return { order_id: orderId, phase, items: lookup.items, request_diagnostics: lookup.diagnostics,
    explicit_requests: lookup.diagnostics.length, read_only: true, write_authorized: false,
    status: lookup.deferred ? 'deferred' : 'read', fetch_started: !lookup.deferred, read_deadline_ms: readDeadlineMs,
    defer_reason: lookup.defer_reason };
}

export function parseQnConsignDetailText(text, orderId = '') {
  const raw = rawText(text);
  const shippedAt = firstExtractedLine(raw, ['发货时间', '实际发货时间']);
  return {
    order_id: cleanText(orderId),
    tracking_number: firstExtractedLine(raw, ['运单号', '物流单号', '快递单号']),
    logistics_company: firstExtractedLine(raw, ['物流公司名称', '物流公司', '快递公司']),
    shipped_at: isAbsoluteDateTimeText(shippedAt) ? shippedAt : '',
    logistics_status: firstExtractedLine(raw, ['物流状态', '当前状态']),
  };
}

async function readQnPageText(page, url, isReady, timeoutSeconds = 35, legacyOrderId = '') {
  if (!page) throw new Error('Browser page required');
  await navigateQnPage(page, url, { settleMs: 1800 });
  const deadline = Date.now() + Math.max(5, Number(timeoutSeconds || 35)) * 1000;
  let lastSnapshot = null;
  let legacyAttempted = false;
  while (Date.now() < deadline) {
    lastSnapshot = await page.evaluate(`(() => {
      const bodyText = document.body?.innerText || '';
      const parseTradeId = (href) => {
        try {
          const url = new URL(String(href || ''), location.href);
          return url.searchParams.get('tradeId')
            || url.searchParams.get('trade_id')
            || url.searchParams.get('tradeID')
            || '';
        } catch {
          return '';
        }
      };
      const orderItems = Array.from(document.querySelectorAll('tr.order-item')).map((row) => {
        const cells = Array.from(row.querySelectorAll(':scope > td'));
        const titleLink = row.querySelector('a[href*="tradeSnap"], a[href*="trade_snap"]');
        const priceParts = String(cells.at(-1)?.innerText || '').split(/\\n+/).map((part) => part.trim()).filter(Boolean);
        return {
          sub_order_id: parseTradeId(titleLink?.getAttribute('href')),
          title: String(titleLink?.textContent || '').trim(),
          raw_status: String(cells[2]?.innerText || '').split(/\\n+/)[0]?.trim() || '',
          unit_price: priceParts[0] || '',
          quantity: Number(String(priceParts[1] || '').replace(/^x/i, '')) || 0,
        };
      });
      const packages = Array.from(document.querySelectorAll('[class*="partial-ship_item-container"]')).map((item) => {
        const text = String(item.innerText || '');
        const values = Array.from(item.querySelectorAll('[class*="partial-ship_item-name"]'))
          .map((node) => String(node.textContent || '').trim())
          .filter(Boolean);
        const valueAfter = (label) => {
          const index = values.findIndex((value) => value === label || value === label.replace(':', '：'));
          return index >= 0 ? (values[index + 1] || '') : '';
        };
        const links = Array.from(item.querySelectorAll('a[href*="tradeId"], a[href*="trade_id"]'));
        return {
          sub_order_ids: [...new Set(links.map((link) => parseTradeId(link.getAttribute('href'))).filter(Boolean))],
          logistics_company: values.find((value) => !value.includes('包裹') && !value.includes('运单号码') && !value.includes('发货时间') && !/^\\d{4}-/.test(value) && !/[A-Z]{1,4}\\d{6,}/i.test(value)) || '',
          tracking_number: valueAfter('运单号码:') || valueAfter('运单号:') || '',
          shipped_at: valueAfter('发货时间:') || '',
          text,
        };
      });
      return {
        href: location.href,
        title: document.title || '',
        bodyText,
        orderItems,
        packages,
        legacyOrderDetailUrl: bodyText.includes('当前页面暂无法展示该订单')
          ? Array.from(document.querySelectorAll('a[href]')).find(a => a.textContent.includes('前往旧版查看'))?.href || ''
          : '',
        verificationLike: Array.from(document.querySelectorAll('iframe[src*="/_____tmd_____/punish"]')).some(frame => {
          const rect = frame.getBoundingClientRect();
          const style = getComputedStyle(frame);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        }),
        loginLike: location.href.includes('login') ||
          bodyText.includes('扫码登录') ||
          bodyText.includes('手机验证码登录'),
      };
    })()`);
    if (lastSnapshot.verificationLike) {
      const error = new Error('千牛需要人工验证（FAIL_SYS_USER_VALIDATE），已停止读取。');
      error.code = 'MANUAL_VERIFICATION';
      throw error;
    }
    if (lastSnapshot.loginLike) {
      throw new Error('QianNiu redirected to login. Please log in in Chrome, then rerun the command.');
    }
    if (isReady(lastSnapshot)) return lastSnapshot;
    if (legacyAttempted) {
      const reason = lastSnapshot.bodyText.includes('你无权查看此交易')
        ? '当前登录账号无权查看该交易' : '未读到该订单的状态或时间';
      throw Object.assign(new Error(`旧版订单 ${legacyOrderId}：${reason}；本次读取已结束，未重试。`), { code: 'QN_LEGACY_ORDER_UNREADABLE' });
    }
    if (legacyOrderId && lastSnapshot.bodyText.includes('当前页面暂无法展示该订单')) {
      let legacyUrl;
      try { legacyUrl = new URL(lastSnapshot.legacyOrderDetailUrl); } catch {}
      if (legacyUrl?.origin !== 'https://trade.taobao.com'
        || legacyUrl.pathname !== '/trade/detail/trade_order_detail.htm'
        || legacyUrl.searchParams.get('biz_order_id') !== legacyOrderId) {
        throw Object.assign(new Error(`订单 ${legacyOrderId} 需要旧版详情，但页面未提供该订单的有效入口；本次读取已结束。`), { code: 'QN_LEGACY_ORDER_UNREADABLE' });
      }
      legacyAttempted = true;
      await navigateQnPage(page, legacyUrl.href, { settleMs: 1800 });
      continue;
    }
    await page.wait({ time: 1 });
  }
  throw new Error(`QianNiu detail page did not finish loading. Last URL: ${lastSnapshot?.href ?? 'unknown'}`);
}

export async function readQnOrderDetail(page, target, timeoutSeconds = 35, readPolicy = {}) {
  const requestSpacingSeconds = Number(readPolicy.requestSpacingSeconds ?? process.env.QN_ORDER_READ_SPACING_SECONDS ?? 0);
  if (![0, 20].includes(requestSpacingSeconds)) throw new Error('invalid_qn_read_spacing');
  const orderId = resolveQnOrderId(target);
  const url = buildQnOrderDetailUrl(orderId);
  const detailStartedAt = Date.now();
  const snapshot = await readQnPageText(
    page,
    url,
    (item) => looksLikeQnOrderDetail(item, orderId),
    timeoutSeconds,
    orderId,
  );
  const parsed = parseQnOrderDetailText(snapshot.bodyText, orderId);
  let requestDiagnostics = [{ phase: 'detail_page', started_at_ms: detailStartedAt, finished_at_ms: Date.now() }];
  let itemShipments = [];
  let itemEvidenceError = '';
  let itemEvidenceErrorDetail = null;
  if (parsed.terminal_status || parsed.raw_order_status.includes('部分发货') || parsed.raw_order_status.includes('分批发货')) {
    let soldItems = [];
    try {
      const lookup = await lookupQnSoldListItems(page, orderId, requestSpacingSeconds);
      soldItems = lookup.items;
      requestDiagnostics.push(...lookup.diagnostics);
    } catch (error) {
      if (error?.code === 'MANUAL_VERIFICATION' || /FAIL_SYS_USER_VALIDATE/.test(String(error?.message || error))) throw error;
      itemEvidenceError = 'sold_item_read_failed';
      itemEvidenceErrorDetail = { code: error?.code ?? null, message: String(error?.message || error) };
      soldItems = [];
    }
    itemShipments = mergeQnPartialShipmentItems(snapshot.orderItems, snapshot.packages, soldItems);
  }
  return {
    ...parsed,
    item_shipments: itemShipments,
    item_evidence_error: itemEvidenceError,
    item_evidence_error_detail: itemEvidenceErrorDetail,
    request_diagnostics: requestDiagnostics,
    url: snapshot.href || url,
    title: snapshot.title || '',
  };
}

export async function readQnConsignDetail(page, target, timeoutSeconds = 35) {
  const orderId = resolveQnOrderId(target);
  const url = buildQnConsignDetailUrl(orderId);
  const snapshot = await readQnPageText(
    page,
    url,
    (item) => looksLikeQnConsignDetail(item, orderId),
    timeoutSeconds,
  );
  return {
    ...parseQnConsignDetailText(snapshot.bodyText, orderId),
    url: snapshot.href || url,
    title: snapshot.title || '',
  };
}

export function resolveDownloadDir(rawDir) {
  const input = cleanText(rawDir);
  if (!input) return path.join(os.homedir(), 'Downloads');
  if (input === '~') return os.homedir();
  if (input.startsWith('~/')) return path.join(os.homedir(), input.slice(2));
  return path.resolve(input);
}

function isExcelDownloadFile(fileName) {
  if (!fileName || fileName.endsWith('.crdownload') || fileName.startsWith('~$')) return false;
  return EXCEL_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

export function newestDownloadAfter(downloadDir, startedAtMs) {
  if (!fs.existsSync(downloadDir)) return null;
  const candidates = fs.readdirSync(downloadDir)
    .filter(isExcelDownloadFile)
    .map((fileName) => {
      const filePath = path.join(downloadDir, fileName);
      const stat = fs.statSync(filePath);
      return { file: filePath, bytes: stat.size, mtimeMs: stat.mtimeMs };
    })
    .filter((entry) => entry.mtimeMs >= startedAtMs - 1000 && entry.bytes > 0)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0] ?? null;
}

export async function waitForNewDownload(downloadDir, startedAtMs, timeoutSeconds = DEFAULT_WAIT_SECONDS) {
  const deadline = Date.now() + Math.max(1, Number(timeoutSeconds || DEFAULT_WAIT_SECONDS)) * 1000;
  while (Date.now() < deadline) {
    const candidate = newestDownloadAfter(downloadDir, startedAtMs);
    if (candidate) return candidate;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`No Excel download appeared in ${downloadDir} within ${timeoutSeconds}s`);
}

export function parseExportFieldsFromText(text) {
  const source = String(text || '');
  const markerIndex = source.indexOf('显示字段');
  const section = markerIndex >= 0 ? source.slice(markerIndex) : source;
  return EXPORT_FIELDS.filter((field) => section.includes(field));
}

export function parseExportRecordsFromText(text, limit = 20) {
  const lines = String(text || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const rows = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(line)) continue;
    const rowCount = lines[index + 1] || '';
    const operator = lines[index + 2] || '';
    const status = lines[index + 3] || '';
    if (!/^\d+$/.test(rowCount)) continue;
    rows.push({
      export_time: line,
      row_count: Number(rowCount),
      operator,
      status,
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

function parseJsonMaybe(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value;
  const text = cleanText(value);
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function selectedCopy(item, selected) {
  return { ...item, choose: selected ? 'true' : 'false' };
}

export function withSelectedQuickFilter(quickFilterList, rawFilter = 'all') {
  const resolved = resolveQuickFilter(rawFilter);
  const list = Array.isArray(quickFilterList) ? quickFilterList : [];
  if (!resolved.apiKey) return list;
  return list.map((item) => selectedCopy(item, item?.key === resolved.apiKey));
}

export function withSelectedSort(formDisplayDto, rawSort = 'pay-desc') {
  const option = resolveSortOption(rawSort || 'pay-desc');
  const form = formDisplayDto && typeof formDisplayDto === 'object'
    ? { ...formDisplayDto }
    : {};
  const sortTypeList = Array.isArray(form.sortTypeList) ? form.sortTypeList : [];
  form.sortTypeList = sortTypeList.map((item) => selectedCopy(item, item?.key === option.apiKey));
  return form;
}

function normalizeSkuInfos(value) {
  if (!Array.isArray(value)) return '';
  return value
    .map((item) => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      return cleanText(item.value ?? item.name ?? item.text ?? item.label);
    })
    .filter(Boolean)
    .join(' ');
}

function parseMerchantCodeFromTags(tags) {
  if (!Array.isArray(tags)) return '';
  for (const tag of tags) {
    const text = cleanText(tag);
    const match = text.match(/商家编码\s+(.+)$/);
    if (match) return cleanText(match[1]);
  }
  return '';
}

function formatReceiverAddress(receiver = {}) {
  return [
    receiver.prov,
    receiver.city,
    receiver.area,
    receiver.town,
    receiver.address || receiver.noSplitCharDetailAddress,
  ].map(cleanText).filter(Boolean).join(' ');
}

function orderSellerIdentities(order) {
  return [order.shopName, order.sellerNick].map(cleanText).filter(Boolean);
}

export function detectSalesChannel(order = {}, item = {}) {
  const shopName = cleanText(order.shopName || order.sellerNick || order.loginUser);
  const extAttr = item.itemExtAttr || {};
  const extValues = Object.values(extAttr).map(cleanText).join(' ');
  const isXianyu = /idle/i.test(extValues);
  if (isXianyu) {
    const aliases = new Map([
      ['小sop', 'Gumo Studio'],
      ['gumo studio', 'Gumo Studio'],
      ['茶煲星星', '茶煲星星'],
      ['茶包星星', '茶煲星星'],
    ]);
    const identities = orderSellerIdentities(order);
    const sellers = identities.map(identity => aliases.get(identity.toLowerCase()));
    const seller = sellers[0];
    const conflict = sellers.some(candidate => candidate && candidate !== seller);
    return {
      type: '闲鱼',
      notionChannel: `闲鱼 - ${seller && !conflict ? seller : '未识别店铺'}`,
      isXianyu: true,
    };
  }
  if (shopName === 'tb940798830') {
    return {
      type: '淘宝',
      notionChannel: '淘宝 - Youtooz',
      isXianyu: false,
    };
  }
  if (shopName === '茶煲星星') {
    return {
      type: '淘宝',
      notionChannel: '淘宝 - 茶煲星星',
      isXianyu: false,
    };
  }
  return {
    type: '淘宝',
    notionChannel: '淘宝 - Gumo Studio',
    isXianyu: false,
  };
}

export function flattenConsignOrderRows(orderList = []) {
  const rows = [];
  for (const order of orderList || []) {
    const details = Array.isArray(order.itemDetailInfoList) ? order.itemDetailInfoList : [];
    const receiver = order.receiver || {};
    const logistics = (order.logisticsInfoList || [])[0] || {};
    const memoText = (order.memoInfoList || [])
      .map((memo) => cleanText(memo?.memo || memo?.memoText || memo?.sellerMemo || memo?.remark))
      .filter(Boolean)
      .join(' | ');
    for (const item of details) {
      const merchantCode = cleanText(item?.outSkuId)
        || cleanText(item?.outItemId)
        || parseMerchantCodeFromTags(item?.itemTags);
      const channel = detectSalesChannel(order, item);
      rows.push({
        source: 'qn-order-api',
        page_source: order.source || '',
        店铺名称: channel.isXianyu
          ? orderSellerIdentities(order)[0] || ''
          : [order.shopName, order.sellerNick, order.loginUser].map(cleanText).find(Boolean) || '',
        下单渠道: channel.notionChannel,
        渠道类型: channel.type,
        是否闲鱼: channel.isXianyu ? 'true' : 'false',
        订单编号: cleanText(item?.mainBizOrderId || order.orderIdInfo?.mainBizOrderId),
        子订单编号: cleanText(item?.bizOrderId),
        买家昵称: cleanText(order.buyerNick),
        收件人姓名: cleanText(receiver.name),
        收件人手机号: cleanText(receiver.phone),
        收件人省: cleanText(receiver.prov),
        收件人市: cleanText(receiver.city),
        收件人区: cleanText(receiver.area),
        收件人详细地址: cleanText(receiver.address || receiver.noSplitCharDetailAddress),
        收件人地址: formatReceiverAddress(receiver),
        下单时间: cleanText(item?.createOrderTime),
        付款时间: cleanText(item?.payTime || order.payTime),
        商品名称: cleanText(item?.itemTitle),
        商品id: cleanText(item?.itemId),
        skuid: cleanText(item?.skuId || item?.skuIdStr || item?.sku_id),
        商品简称: cleanText(item?.simpleItemTitle),
        商品商家编码: cleanText(item?.outItemId),
        商品规格: normalizeSkuInfos(item?.skuInfos),
        商品规格简称: cleanText(item?.simpleSkuTitle || item?.simpleSkuName),
        商品规格商家编码: merchantCode,
        商品数量: Number(item?.buyAmount ?? 0),
        商品单价: cleanText(item?.price),
        商品实付金额: cleanText(item?.actualPayAmount ?? order.actualPrice),
        子订单状态: cleanText(order.consignStatusEnum),
        退款状态: cleanText(item?.refundStatus ?? item?.refundStatusInt),
        快递单号: cleanText(logistics.mailNo),
        发货时间: cleanText(order.consignTime),
        物流公司: cleanText(logistics.cpName),
        物流状态: cleanText(logistics.title || logistics.statusDesc),
        物流状态说明: cleanText(logistics.statusDesc),
        物流更新时间: cleanText(logistics.time || logistics.getTime || logistics.gmtCreate),
        物流轨迹描述: cleanText(logistics.desc),
        快递单打印时间: cleanText(order.lastPrintTime),
        重量: cleanText(order.weight),
        体积: cleanText(order.volume),
        运费: cleanText(order.totalDeliveryFee),
        买家留言: cleanText(order.buyerMessage || order.buyerMemo || item?.buyerMessage),
        卖家备注: memoText,
        consign_order_id: cleanText(order.consignOrderId),
        encode_id: cleanText(order.encodeId),
        platform: cleanText(order.platform),
        delivery_status: cleanText(order.deliveryStatus),
        total_order_amount: cleanText(order.actualPrice),
      });
    }
  }
  return rows;
}

async function waitForQnOrderPage(page, orderPage, timeoutSeconds = 35) {
  const deadline = Date.now() + Math.max(5, timeoutSeconds) * 1000;
  let lastMeta = null;
  while (Date.now() < deadline) {
    lastMeta = await page.evaluate(`(() => {
      const bodyText = document.body?.innerText || '';
      return {
        href: location.href,
        title: document.title || '',
        hasOrderShell: bodyText.includes('待发货') && bodyText.includes('同步订单'),
        hasTargetPage: bodyText.includes(${JSON.stringify(orderPage.label)}),
        loginLike: location.href.includes('login') || bodyText.includes('扫码登录') || bodyText.includes('手机验证码登录'),
      };
    })()`);
    if (lastMeta.loginLike) {
      throw new Error('QianNiu redirected to login. Please log in in Chrome, then rerun the command.');
    }
    if (lastMeta.hasOrderShell && lastMeta.hasTargetPage) {
      return { ...orderPage, href: lastMeta.href, title: lastMeta.title };
    }
    await page.wait({ time: 1 });
  }
  throw new Error(`QianNiu order page did not finish loading. Last URL: ${lastMeta?.href ?? 'unknown'}`);
}

export async function ensureQnOrderPage(page, rawPage = 'unshipped', timeoutSeconds = 35) {
  if (!page) throw new Error('Browser page required');
  const orderPage = resolveOrderPage(rawPage);
  const current = page.getActivePage?.() ? await page.evaluate('location.href') : '';
  if (/^https:\/\/qn\.taobao\.com\/home\.htm\/qn-order\//.test(current)) {
    const key = Object.keys(ORDER_PAGES).find(key => new URL(ORDER_PAGES[key].url).pathname === new URL(current).pathname);
    if (key) return await waitForQnOrderPage(page, resolveOrderPage(key), timeoutSeconds);
  }
  await navigateQnPage(page, orderPage.url, { settleMs: 1800 });
  return await waitForQnOrderPage(page, orderPage, timeoutSeconds);
}

export async function refreshQnOrderPage(page, rawPage = 'unshipped', timeoutSeconds = 35) {
  return await ensureQnOrderPage(page, rawPage, timeoutSeconds);
}

export async function requestQnMtop(page, api, data = {}, options = {}, runtimeOptions = {}) {
  if (!page) throw new Error('Browser page required');
  return await page.evaluate(`(async () => {
    const api = ${JSON.stringify(api)};
    const data = ${JSON.stringify(data)};
    const options = ${JSON.stringify(options)};
    const runtimeOptions = ${JSON.stringify(runtimeOptions)};
    const maxAttempts = String(options.type || '').toUpperCase() === 'POST'
      ? 1 : Math.max(1, Number(runtimeOptions.maxAttempts || 3));
    const retryDelayMs = Math.max(0, Number(runtimeOptions.retryDelayMs ?? 500));
    const requireNoVerification = (ret = []) => {
      const frames = typeof document === 'undefined' ? []
        : document.querySelectorAll?.('iframe[src*="/_____tmd_____/punish"]') || [];
      const visibleChallenge = Array.from(frames).some(frame => {
        const rect = frame.getBoundingClientRect();
        const style = getComputedStyle(frame);
        return rect.width > 0 && rect.height > 0
          && style.display !== 'none' && style.visibility !== 'hidden';
      });
      if (visibleChallenge || (Array.isArray(ret)
        && ret.some(value => String(value).startsWith('FAIL_SYS_USER_VALIDATE')))) {
        const error = new Error('QianNiu requires manual verification (FAIL_SYS_USER_VALIDATE); 未自动重试，请先完成人工验证并读回确认。');
        error.code = 'MANUAL_VERIFICATION';
        throw error;
      }
    };
    const formatThrownValue = (value) => {
      if (value instanceof Error) return value.message || value.name;
      if (typeof value === 'string') return value;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    };
    const deadline = Date.now() + 30000;
    while (!window.__UNIVERSAL_MTOP_APPEND_LIB_MTOP_IN_BROWSER__) {
      if (Date.now() > deadline) {
        throw new Error('QianNiu mtop runtime did not become available.');
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const mtop = await window.__UNIVERSAL_MTOP_APPEND_LIB_MTOP_IN_BROWSER__;
    const request = { api, v: '1.0', data, ...options };
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      requireNoVerification();
      try {
        const response = await mtop.request(request);
        requireNoVerification(response?.ret);
        return {
          ret: response?.ret || [],
          data: response?.data || {},
          traceId: response?.traceId || '',
          api: response?.api || api,
        };
      } catch (error) {
        if (error?.code === 'MANUAL_VERIFICATION') throw error;
        requireNoVerification(error?.ret);
        if (runtimeOptions.returnBusinessFailure && Array.isArray(error?.ret)
          && error.ret.length > 0 && error.ret.every(value => String(value).startsWith('UNKNOWN_FAIL_CODE::'))) {
          let businessResult;
          try { businessResult = typeof error?.data?.result === 'string'
            ? JSON.parse(error.data.result) : error?.data?.result; } catch { businessResult = null; }
          if (businessResult?.success === false) return {
            ret: error.ret, data: error.data, traceId: error.traceId || '', api: error.api || api,
          };
        }
        lastError = error;
        if (attempt >= maxAttempts) break;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
      }
    }
    throw new Error(\`QianNiu mtop request failed after \${maxAttempts} attempts; \${maxAttempts === 1 ? "未自动重试，请先读回确认结果：" : ""}\${formatThrownValue(lastError)}\`);
  })()`);
}

function parseJsonStringMaybe(value, fallback = null) {
  if (typeof value !== 'string') return value ?? fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function buildQnItemAliasUpdateBody(updates, options = {}) {
  if (!Array.isArray(updates) || !updates.length) {
    throw new Error('At least one item alias update is required');
  }
  const normalizedUpdates = updates.map((update) => {
    const itemId = cleanText(update?.itemId ?? update?.商品id ?? update?.商品ID);
    if (!itemId) throw new Error('item-id is required');
    const next = {
      itemId,
      alias: cleanText(update?.alias ?? update?.商品简称),
    };
    const skuId = cleanText(update?.skuId ?? update?.skuid);
    if (skuId) next.skuId = skuId;
    const weight = cleanText(update?.weight ?? update?.重量);
    if (weight) next.weight = weight;
    return next;
  });
  const body = {
    updateItemInfoListStr: JSON.stringify(normalizedUpdates),
  };
  const multiShop = cleanText(options.multiShop ?? options.shop ?? options.店铺名称);
  if (multiShop) body.multiShop = multiShop;
  return body;
}

export function buildQnSellerMemoUpdateBody(options = {}) {
  const rawOrderId = cleanText(options.orderId ?? options['order-id'] ?? options.target ?? options.订单编号);
  if (!rawOrderId) throw new Error('order-id is required');
  const orderId = resolveQnOrderId(rawOrderId);
  const memo = cleanText(options.memo ?? options.sellerMemo ?? options.卖家备注);
  if (!memo) throw new Error('memo is required');
  const flagId = resolveQnSellerMemoFlagId(options);
  const params = {
    flagId,
    memoContent: memo,
    tagToUpdateGlobal: JSON.stringify([]),
  };
  const modifyType = options.modifyType ?? options['modify-type'];
  if (modifyType !== undefined && modifyType !== null && cleanText(modifyType) !== '') {
    params.modifyType = Number(modifyType);
  }
  return {
    ...(options.orderInfos ? {orderInfosStr: JSON.stringify(options.orderInfos)} : {orderId}),
    operation: 'update',
    params: JSON.stringify(params),
    source: cleanText(options.source) || 'qn-order',
  };
}

export function resolveQnSellerMemoFlagId(options = {}) {
  const rawFlagId = cleanText(options.flagId ?? options['flag-id'] ?? options.flag ?? options.旗帜);
  const normalized = rawFlagId.toLowerCase();
  const flagId = QN_SELLER_MEMO_FLAG_IDS[normalized] || QN_SELLER_MEMO_FLAG_IDS[rawFlagId] || rawFlagId || '0';
  if (!/^\d{1,2}$/.test(flagId)) throw new Error(`Unsupported seller memo flag: ${rawFlagId}`);
  return flagId;
}

export function buildQnSellerMemoQueryBody(options = {}) {
  const rawOrderId = cleanText(options.orderId ?? options['order-id'] ?? options.target ?? options.订单编号);
  if (!rawOrderId) throw new Error('order-id is required');
  return {
    orderId: resolveQnOrderId(rawOrderId),
    operation: 'query',
    source: cleanText(options.source) || 'qn-order',
  };
}

function messageFromRet(ret) {
  const text = Array.isArray(ret) ? cleanText(ret[0]) : cleanText(ret);
  if (!text) return '';
  const [, message = text] = text.split('::');
  return cleanText(message || text);
}

export function parseQnItemAliasUpdateResponse(response = {}) {
  const ret = Array.isArray(response.ret) ? cleanText(response.ret[0]) : cleanText(response.ret);
  const data = response.data || {};
  const result = parseJsonStringMaybe(data.result, data);
  const success = result?.success === true || data?.success === true || ret.startsWith('SUCCESS');
  const message = cleanText(
    result?.message
      || result?.msg?.text
      || result?.msg
      || data?.message
      || data?.msg
      || messageFromRet(ret),
  );
  return {
    success,
    message,
    ret,
    trace_id: cleanText(response.traceId || response.trace_id),
    result,
  };
}

export function parseQnSellerMemoUpdateResponse(response = {}) {
  const ret = Array.isArray(response.ret) ? cleanText(response.ret[0]) : cleanText(response.ret);
  const data = response.data || {};
  const result = parseJsonStringMaybe(data.result, data);
  const failedOrderIds = result?.updateErrorBizOrderIds || data?.updateErrorBizOrderIds || {};
  const hasFailures = failedOrderIds && typeof failedOrderIds === 'object' && Object.keys(failedOrderIds).length > 0;
  const success = !hasFailures && (
    result?.success === true
    || data?.success === true
    || ret.startsWith('SUCCESS')
  );
  const message = cleanText(
    result?.message
      || result?.msg?.text
      || result?.msg
      || data?.message
      || data?.msg
      || (hasFailures ? Object.values(failedOrderIds).map(cleanText).filter(Boolean).join('; ') : '')
      || messageFromRet(ret),
  );
  return {
    success,
    message,
    ret,
    trace_id: cleanText(response.traceId || response.trace_id),
    result,
  };
}

export function parseQnSellerMemoQueryResponse(response = {}) {
  const ret = Array.isArray(response.ret) ? cleanText(response.ret[0]) : cleanText(response.ret);
  const data = response.data || {};
  const result = parseJsonStringMaybe(data.result, data);
  const memoSource = result?.memo || result?.sellerMemo || result?.data || result || data;
  const latestRecord = Array.isArray(result?.editRecordList) ? result.editRecordList[0] : null;
  const memo = cleanText(
    memoSource?.memoContent
      || memoSource?.content
      || memoSource?.memo
      || memoSource?.sellerMemo
      || memoSource?.remark
      || latestRecord?.content,
  );
  const flagId = cleanText(
    memoSource?.selectedFlagId
      ?? memoSource?.flagId
      ?? memoSource?.flag
      ?? memoSource?.sellerFlag
      ?? memoSource?.sellerMemoFlag
      ?? latestRecord?.flagId
      ?? result?.selectedFlagId
      ?? result?.flagId
      ?? data?.flagId,
  );
  return {
    success: ret.startsWith('SUCCESS') || result?.success === true || data?.success === true || Boolean(memo || flagId),
    memo,
    flag_id: flagId,
    ret,
    trace_id: cleanText(response.traceId || response.trace_id),
    result,
  };
}

export async function updateQnItemAlias(page, updates, options = {}) {
  const response = await requestQnMtop(
    page,
    QN_ITEM_ALIAS_UPDATE_API,
    buildQnItemAliasUpdateBody(updates, options),
    { type: 'POST' },
  );
  return parseQnItemAliasUpdateResponse(response);
}

export async function updateQnSellerMemo(page, options = {}) {
  const response = await requestQnMtop(
    page,
    QN_SELLER_MEMO_API,
    buildQnSellerMemoUpdateBody(options),
    { type: 'POST', timeout: 5000 },
  );
  return parseQnSellerMemoUpdateResponse(response);
}

export async function queryQnSellerMemo(page, options = {}) {
  const response = await requestQnMtop(
    page,
    QN_SELLER_MEMO_API,
    buildQnSellerMemoQueryBody(options),
    { type: 'POST', timeout: 5000 },
  );
  return parseQnSellerMemoQueryResponse(response);
}

export function findQnOrderShortNameMatches(rows, criteria = {}) {
  const itemId = cleanText(criteria.itemId ?? criteria['item-id'] ?? criteria.商品id ?? criteria.商品ID);
  const orderId = cleanText(criteria.orderId ?? criteria['order-id'] ?? criteria.订单编号);
  const merchantCode = cleanText(criteria.merchantCode ?? criteria['merchant-code'] ?? criteria.商品规格商家编码 ?? criteria.商品商家编码);
  const shop = cleanText(criteria.shop ?? criteria.店铺名称);

  return (rows || []).filter((row) => {
    if (itemId) {
      const rowItemId = cleanText(row?.商品id ?? row?.商品ID ?? row?.itemId);
      if (rowItemId !== itemId) return false;
    }
    if (orderId) {
      const ids = [
        row?.订单编号,
        row?.子订单编号,
        row?.order_id,
        row?.orderId,
        row?.bizOrderId,
      ].map(cleanText);
      if (!ids.includes(orderId)) return false;
    }
    if (merchantCode) {
      const codes = [
        row?.商品规格商家编码,
        row?.商品商家编码,
        row?.商家编码,
        row?.outerId,
        row?.outSkuId,
      ].map(cleanText);
      if (!codes.includes(merchantCode)) return false;
    }
    if (shop) {
      const rowShop = cleanText(row?.店铺名称 ?? row?.shopName ?? row?.sellerNick);
      if (rowShop !== shop) return false;
    }
    return true;
  });
}

export async function lookupQnSoldListBuyerNickname(page, orderId) {
  if (!page) throw new Error('Browser page required');
  const normalizedOrderId = resolveQnOrderId(orderId);
  const latestLookupBody = buildQnSoldLatestLookupBody(normalizedOrderId);
  const historicalLookupBody = buildQnSoldHistoricalLookupBody(normalizedOrderId);
  return await page.evaluate(`(async () => {
    const orderId = ${JSON.stringify(normalizedOrderId)};
    const apiUrl = ${JSON.stringify(SOLD_LOOKUP_API_URL)};
    const latestLookupBody = ${JSON.stringify(latestLookupBody)};
    const historicalLookupBody = ${JSON.stringify(historicalLookupBody)};
    const collapse = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const isPlausibleNickname = (value) => {
      const text = collapse(value);
      if (!text || text.length < 2 || text.includes('*')) return false;
      const blockedFragments = [
        '创建时间',
        '号码保护',
        '订单号',
        '联系电话',
        '买家信息',
        '物流信息',
        '收货地址',
        '支付宝',
        '付款给买家',
        '谨慎操作',
        '买家留言',
        'Alibaba',
        'Gumo',
        'GUMO',
        'Deep Toys',
        'Youtooz',
        '茶煲星星',
        '￥',
        ':',
        '：',
      ];
      return !blockedFragments.some((fragment) => text.includes(fragment));
    };
    const decodePercentEncodedBytes = (source) => {
      const text = String(source || '');
      const bytes = [];
      for (let index = 0; index < text.length;) {
        if (text[index] === '%' && /^[0-9a-fA-F]{2}$/.test(text.slice(index + 1, index + 3))) {
          bytes.push(parseInt(text.slice(index + 1, index + 3), 16));
          index += 3;
          continue;
        }
        const code = text.charCodeAt(index);
        if (code <= 0x7f) bytes.push(code);
        index += 1;
      }
      return bytes.length ? new Uint8Array(bytes) : null;
    };
    const scoreNicknameQuality = (candidate) => {
      const text = collapse(candidate);
      if (!isPlausibleNickname(text)) return -100;
      let score = 0;
      if (/[\\u4e00-\\u9fff]/.test(text)) score += 6;
      if (/[A-Za-z]/.test(text)) score += 2;
      if (/\\d/.test(text)) score += 1;
      if (text.includes('锟')) score -= 8;
      if (/[\\u0400-\\u04FF]/.test(text)) score -= 6;
      if (/\\uFFFD/.test(text)) score -= 8;
      return score;
    };
    const isSuspiciousMojibake = (candidate) => {
      const text = collapse(candidate);
      if (!text) return false;
      if (text.includes('锟') || text.includes('锟斤拷') || text.includes('\\uFFFD')) return true;
      if (/[\\u0400-\\u04FF]/.test(text)) return true;
      return /^[^\\u4e00-\\u9fffA-Za-z0-9_]+[A-Za-z0-9_]+$/.test(text);
    };
    const preferReadableNickname = (candidates) => {
      const deduped = [];
      for (const candidate of candidates || []) {
        const text = collapse(candidate);
        if (isPlausibleNickname(text) && !deduped.includes(text)) deduped.push(text);
      }
      if (deduped.length < 2) return null;
      const sorted = [...deduped].sort((left, right) => scoreNicknameQuality(right) - scoreNicknameQuality(left));
      return scoreNicknameQuality(sorted[0]) > scoreNicknameQuality(sorted[1]) ? sorted[0] : null;
    };
    const recoverEncodedNickname = (rawEncodedValue, decodedValue) => {
      const decoded = collapse(decodedValue);
      const bytes = decodePercentEncodedBytes(rawEncodedValue);
      if (!bytes || !bytes.length) return decoded;
      let recovered = '';
      try {
        recovered = collapse(new TextDecoder('gb18030').decode(bytes));
      } catch {
        recovered = '';
      }
      if (!isPlausibleNickname(recovered)) return decoded;
      if (!isPlausibleNickname(decoded)) return recovered;
      return scoreNicknameQuality(recovered) > scoreNicknameQuality(decoded) ? recovered : decoded;
    };
    const parseMemberUserId = (memberUrl) => {
      try {
        const url = new URL(String(memberUrl || ''), 'https://trade.taobao.com');
        const rawMatch = String(url.search || '').match(/[?&]userID=([^&#]+)/i);
        const rawUserId = rawMatch?.[1] || '';
        const userId = recoverEncodedNickname(rawUserId, url.searchParams.get('userID') || '');
        return isPlausibleNickname(userId) ? userId : null;
      } catch {
        return null;
      }
    };
    const findMatchedOrder = (parsed) => {
      const orders = Array.isArray(parsed?.mainOrders) ? parsed.mainOrders : [];
      return orders.find((order) => {
        const ids = [
          order?.id,
          order?.orderId,
          order?.mainBizOrderId,
          order?.bizOrderId,
          order?.orderInfo?.id,
          order?.orderInfo?.orderId,
        ].map((value) => collapse(value));
        return ids.includes(orderId);
      });
    };
    const pickLookupFromResponse = (parsed) => {
      const matchedOrder = findMatchedOrder(parsed);
      if (!matchedOrder) return null;
      const memberUserId = parseMemberUserId(matchedOrder?.buyer?.memberUrl);
      const buyerNick = collapse(matchedOrder?.buyer?.nick || '');
      const nickname = preferReadableNickname([memberUserId, buyerNick]) ||
        memberUserId ||
        (isPlausibleNickname(buyerNick) ? buyerNick : null);
      if (nickname) return { matched: true, nickname, source: 'sold-list-nickname' };
      return {
        matched: true,
        nickname: null,
        maskedNick: buyerNick,
        source: buyerNick ? 'sold-list-masked-nickname' : 'sold-list-nickname-hidden',
      };
    };
    const parseSoldLookupResponse = async (response) => {
      const buffer = await response.arrayBuffer();
      const texts = [];
      for (const encoding of ['utf-8', 'gb18030']) {
        try {
          const text = new TextDecoder(encoding).decode(buffer);
          if (text && !texts.includes(text)) texts.push(text);
        } catch {
          // Ignore unsupported decoder errors.
        }
      }
      return texts
        .map((text) => {
          try {
            return JSON.parse(text);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    };
    const postLookup = async (body, source) => {
      const response = await fetch(apiUrl, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        body: new URLSearchParams(body).toString(),
      });
      if (!response.ok) return null;
      const parsedPayloads = await parseSoldLookupResponse(response);
      const lookupCandidates = parsedPayloads
        .map((parsed) => pickLookupFromResponse(parsed))
        .filter(Boolean);
      const nickCandidates = lookupCandidates
        .map((lookup) => lookup.nickname)
        .filter((candidate) => isPlausibleNickname(candidate));
      const nickname = preferReadableNickname(nickCandidates) ||
        nickCandidates.find((candidate) => !isSuspiciousMojibake(candidate)) ||
        nickCandidates[0] ||
        null;
      const hiddenMatch = lookupCandidates.find((lookup) => lookup.matched);
      if (nickname) return { nickname, source, navigated: false };
      return hiddenMatch ? {
        nickname: '',
        source: hiddenMatch.source,
        maskedNick: hiddenMatch.maskedNick || '',
        navigated: false,
      } : null;
    };

    const latestResult = await postLookup(latestLookupBody, 'async-sold-latest3Months');
    if (latestResult) return latestResult;
    return await postLookup(historicalLookupBody, 'async-sold-before3Months');
  })()`);
}

export async function fetchQnOrderHomepage(page, source = 'WAIT_CONSIGN') {
  const response = await requestQnMtop(
    page,
    'mtop.alibaba.fulfillment.printorder.pc.homepage.render',
    { source, channel: '', closeQueryOrder: true },
  );
  return response.data || {};
}

export function buildOrderListPayload(homepageData, options = {}) {
  const source = options.source || 'WAIT_CONSIGN';
  const quickFilterList = withSelectedQuickFilter(homepageData?.quickFilterList, options.quickFilter || 'all');
  const formDisplayDto = withSelectedSort(homepageData?.pcFormDisplayDto, options.sort || 'pay-desc');
  return {
    source,
    pageNo: Number(options.pageNo || 1),
    pageSize: Number(options.pageSize || 100),
    filterItemListStr: JSON.stringify(parseJsonMaybe(homepageData?.filterItemList, [])),
    quickFilterListStr: JSON.stringify(quickFilterList),
    formDisplayDtoStr: JSON.stringify(formDisplayDto),
  };
}

export async function fetchQnOrderListPage(page, options = {}) {
  const source = options.source || 'WAIT_CONSIGN';
  const homepageData = options.homepageData || await fetchQnOrderHomepage(page, source);
  const payload = buildOrderListPayload(homepageData, { ...options, source });
  const response = await requestQnMtop(
    page,
    'mtop.alibaba.fulfillment.consign.order.list',
    payload,
    { type: 'POST' },
  );
  const dto = response.data?.pcConsignOrderDto || {};
  const orders = Array.isArray(dto.pcConsignOrderDetailDtoList) ? dto.pcConsignOrderDetailDtoList : [];
  return {
    pageNo: Number(payload.pageNo),
    pageSize: Number(dto.pageSize || payload.pageSize),
    totalOrderCount: Number(dto.totalOrderCount || 0),
    totalPackageCount: Number(dto.totalPackageCount || 0),
    totalItemCount: Number(dto.totalItemCount || 0),
    totalPayAmount: Number(dto.totalPayAmount || 0),
    totalPage: Number(dto.totalPage || 0),
    orders,
  };
}

export async function fetchQnOrderRows(page, options = {}) {
  const source = options.source || 'WAIT_CONSIGN';
  const limit = Number(options.limit ?? 100);
  const maxRows = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : Infinity;
  const pageSize = Math.max(1, Number(options.pageSize || 100));
  const maxPages = Math.max(1, Number(options.maxPages || 20));
  const homepageData = await fetchQnOrderHomepage(page, source);
  const rows = [];
  let lastPage = null;
  for (let pageNo = 1; pageNo <= maxPages && rows.length < maxRows; pageNo += 1) {
    const listPage = await fetchQnOrderListPage(page, {
      ...options,
      source,
      homepageData,
      pageNo,
      pageSize,
    });
    lastPage = listPage;
    const pageRows = flattenConsignOrderRows(
      listPage.orders.map((order) => ({ ...order, source })),
    );
    rows.push(...pageRows);
    if (options.orderId && findQnOrderShortNameMatches(pageRows, { orderId: options.orderId }).length) break;
    if (!listPage.orders.length) break;
    if (listPage.totalPage && pageNo >= listPage.totalPage) break;
    if (listPage.totalOrderCount && pageNo * pageSize >= listPage.totalOrderCount) break;
  }
  return {
    rows: rows.slice(0, Number.isFinite(maxRows) ? maxRows : rows.length),
    totalOrderCount: lastPage?.totalOrderCount ?? 0,
    totalPackageCount: lastPage?.totalPackageCount ?? 0,
    totalItemCount: lastPage?.totalItemCount ?? 0,
    totalPayAmount: lastPage?.totalPayAmount ?? 0,
  };
}

export async function readCurrentSortLabel(page) {
  const labels = SORT_OPTIONS.map((option) => option.label);
  return await page.evaluate(`(() => {
    const labels = ${JSON.stringify(labels)};
    const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const visible = el => {
      if (!el) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const buttons = Array.from(document.querySelectorAll('button')).filter(visible);
    const match = buttons
      .map(button => clean(button.innerText || button.textContent || ''))
      .find(text => labels.includes(text));
    return match || '';
  })()`);
}

async function findVisibleTextCenter(page, labels, selector, options = {}) {
  const labelList = Array.isArray(labels) ? labels : [labels];
  const exact = options.exact !== false;
  const preferRole = options.preferRole || '';
  const result = await page.evaluate(`(() => {
    const labels = ${JSON.stringify(labelList)};
    const selector = ${JSON.stringify(selector)};
    const exact = ${JSON.stringify(exact)};
    const preferRole = ${JSON.stringify(preferRole)};
    const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const visible = el => {
      if (!el) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const matches = Array.from(document.querySelectorAll(selector))
      .filter(visible)
      .map(el => {
        const rect = el.getBoundingClientRect();
        const text = clean(el.innerText || el.textContent || '');
        const role = el.getAttribute('role') || '';
        return {
          text,
          role,
          tag: el.tagName,
          area: rect.width * rect.height,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      })
      .filter(item => labels.some(label => exact ? item.text === label : item.text.includes(label)))
      .sort((a, b) => {
        if (preferRole && a.role === preferRole && b.role !== preferRole) return -1;
        if (preferRole && a.role !== preferRole && b.role === preferRole) return 1;
        return a.area - b.area;
      });
    return matches[0] || null;
  })()`);
  if (!result) return null;
  return result;
}

async function nativeClickByText(page, labels, selector, options = {}) {
  const target = await findVisibleTextCenter(page, labels, selector, options);
  if (!target) return null;
  if (typeof page.nativeClick === 'function') {
    await page.nativeClick(target.x, target.y);
  }
  else {
    await page.evaluate(`(() => {
      const x = ${JSON.stringify(target.x)};
      const y = ${JSON.stringify(target.y)};
      const el = document.elementFromPoint(x, y);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
      el.dispatchEvent(new MouseEvent('mouseover', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
      if (typeof el.click === 'function') el.click();
    })()`);
  }
  return target;
}

export async function readAvailableSortLabels(page) {
  const labels = SORT_OPTIONS.map((option) => option.label);
  const sortButton = await nativeClickByText(page, labels, 'button');
  if (!sortButton) return [];
  await page.wait({ time: 0.7 });
  const result = await page.evaluate(`(() => {
    const labels = ${JSON.stringify(labels)};
    const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const visible = el => {
      if (!el) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const texts = Array.from(document.querySelectorAll('[role="menuitem"], li, span, div'))
      .filter(visible)
      .map(el => clean(el.innerText || el.textContent || ''))
      .filter(text => labels.includes(text));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return [...new Set(texts)];
  })()`);
  return Array.isArray(result) ? result : [];
}

export async function applySort(page, rawSort) {
  const option = resolveSortOption(rawSort);
  if (!option) throw new Error('sort is required');
  const labels = SORT_OPTIONS.map((entry) => entry.label);
  const before = await readCurrentSortLabel(page);
  if (before === option.label) {
    return { ...option, before, after: before, changed: false };
  }
  const sortButton = await nativeClickByText(page, labels, 'button');
  if (!sortButton) {
    throw new Error('Sort dropdown button not found');
  }
  await page.wait({ time: 0.7 });
  const menuItem = await nativeClickByText(page, option.label, '[role="menuitem"], li, span, div', {
    preferRole: 'menuitem',
  });
  if (!menuItem) {
    throw new Error(`Sort option not found in menu: ${option.label}`);
  }
  await page.wait({ time: 1.5 });
  const after = await readCurrentSortLabel(page);
  return { ...option, before, after, changed: before !== after };
}

async function clickExportMenuItem(page, label) {
  await page.evaluate(`(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  })()`);
  await page.wait({ time: 0.2 });
  const exportButton = await nativeClickByText(page, '导出', 'button');
  if (!exportButton) throw new Error('Export button not found');
  await page.wait({ time: 0.6 });
  const menuItem = await nativeClickByText(page, label, '[role="menuitem"], li, span, div', {
    preferRole: 'menuitem',
  });
  if (!menuItem) throw new Error(`Export menu item not found: ${label}`);
}

export async function triggerQueryExport(page, downloadDir, waitSeconds = DEFAULT_WAIT_SECONDS) {
  const startedAtMs = Date.now();
  await clickExportMenuItem(page, '按查询结果导出');
  const download = await waitForNewDownload(downloadDir, startedAtMs, waitSeconds);
  return {
    status: 'downloaded',
    file: download.file,
    bytes: download.bytes,
    downloaded_at: new Date(download.mtimeMs).toISOString(),
  };
}

export async function readExportFields(page) {
  await clickExportMenuItem(page, '导出项设置');
  await page.wait({ time: 0.8 });
  const text = await page.evaluate('document.body?.innerText || ""');
  const fields = parseExportFieldsFromText(text);
  return fields.map((field, index) => ({ index: index + 1, field }));
}

export async function readExportRecords(page, limit = 20) {
  await clickExportMenuItem(page, '导出记录');
  await page.wait({ time: 1.2 });
  const text = await page.evaluate('document.body?.innerText || ""');
  return parseExportRecordsFromText(text, Math.max(1, Number(limit || 20)));
}

export function resolveQnOutboundMemo(currentMemo, marker) {
  const current = cleanText(currentMemo);
  if (!current) return marker;
  if (current.includes(marker)) return current;
  const pattern = /(?:准备出库|商家订单|nuinui~|PO已覆盖) 【Codex｜[^】]+】/;
  const existing = current.match(pattern);
  if (existing && existing[0].startsWith('PO已覆盖') !== marker.startsWith('PO已覆盖')) return current.replace(pattern, marker);
  if (existing && marker.startsWith('nuinui~') && !existing[0].startsWith('nuinui~')) {
    return current.replace(pattern, marker);
  }
  if (existing || (current.includes('准备出库') && current.includes('Codex'))) return current;
  const combined = `${current} ｜ ${marker}`;
  if ([...combined].length > 500) throw new Error('existing_memo_too_long');
  return combined;
}
