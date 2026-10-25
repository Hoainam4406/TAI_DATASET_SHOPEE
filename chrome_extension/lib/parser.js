// Boc du lieu Shopee tu HTML (port 1:1 tu extract_data/ - Python).
//
// Thuan JS, khong phu thuoc DOM -> chay duoc ca trong extension lan Node (test).
//   parseListing(html)  ~ parse_saved_pages.parse_file
//   parsePdp(html)      ~ parse_saved_products.parse_file
//   parseReviews(html)  ~ shopee_crawler/reviews.parse_reviews
//   normalize(entry)    ~ shopee_crawler/parser.normalize
//   merge(base, detail) ~ shopee_crawler/parser.merge

export const CF_BASE = "https://cf.shopee.vn/file/";

export const BASE_COLUMNS = [
  "id", "name", "price", "original_price", "discount_rate", "rating_average",
  "review_count", "sold_count", "seller_id", "seller_name", "brand_name",
  "category_id", "thumbnail_url", "main_image_url", "all_image_urls",
  "url_path", "favourite_count", "created_at_snapshot",
];

export const EXTRA_COLUMNS = [
  "shop_location", "stock", "liked_count", "ctime", "description",
  "rating_breakdown", "rating_5", "rating_4", "rating_3", "rating_2",
  "rating_1", "review_with_comment", "review_with_media", "reviews",
];

// Cot rieng cua file final (gop listing + chi tiet)
export const FINAL_COLUMNS = ["keyword", "search_page", "search_rank", "has_detail"];

// ---------------------------------------------------------------------------
// Tien ich giong Python
// ---------------------------------------------------------------------------

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", hellip: "…", lsquo: "‘",
  rsquo: "’", ldquo: "“", rdquo: "”", bull: "•",
  middot: "·", copy: "©", reg: "®", trade: "™",
  deg: "°", times: "×", laquo: "«", raquo: "»",
};

/** ~ html.unescape (cac entity thuong gap + dang so). */
export function unescapeHtml(text) {
  return String(text ?? "").replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

/** round() cua Python 3 (lam tron ve so chan khi .5). */
export function pyRound(x, ndigits = 0) {
  const f = 10 ** ndigits;
  const v = x * f;
  const r = Math.round(v);
  const out = Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
  return out / f;
}

/** ~ json.dumps(x, ensure_ascii=False) (dau phan cach ", " va ": "). */
export function pyJson(x) {
  if (Array.isArray(x)) return `[${x.map(pyJson).join(", ")}]`;
  if (x && typeof x === "object") {
    return `{${Object.entries(x).map(([k, v]) => `${JSON.stringify(k)}: ${pyJson(v)}`).join(", ")}}`;
  }
  return JSON.stringify(x ?? null);
}

function isEmpty(v) {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

function strictInt(v) {
  if (typeof v === "number") return Number.isInteger(v) ? v : null;
  return /^\s*-?\d+\s*$/.test(String(v ?? "")) ? parseInt(v, 10) : null;
}

// ---------------------------------------------------------------------------
// So "da ban"
// ---------------------------------------------------------------------------

// "10k+", "1,6k", "1,2tr", "282", "1.234"; khong lay gia tien ("584.364 ₫").
const NUM = String.raw`\d[\d.,]*\s*(?:k|tr|triệu|m)?\+?(?![\d.,]|\s*[₫đ])`;
const TAG = /<[^>]+>/g;
const SOLD = new RegExp(
  String.raw`đã\s*bán\s*(${NUM})` +
  String.raw`|(${NUM})\s*(?:đã\s*bán(?!\s*\d)|sold(?!\s*\d[\d.,]*\s*[₫đ]))`,
  "i",
);

/** '10k+' -> 10000, '1,6k' -> 1600, '1,2tr' -> 1200000, '1.234' -> 1234. */
export function parseSold(text) {
  let s = String(text ?? "").trim().toLowerCase().replace(/ /g, "").replace(/\++$/, "");
  let mult = 1;
  for (const [suffix, m] of [["triệu", 1e6], ["tr", 1e6], ["m", 1e6], ["k", 1000]]) {
    if (s.endsWith(suffix)) { mult = m; s = s.slice(0, -suffix.length); break; }
  }
  s = mult === 1 ? s.replace(/[.,]/g, "") : s.replace(/,/g, ".");
  if (!/^\s*[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i.test(s)) return "";
  return pyRound(parseFloat(s) * mult);
}

/** So "da ban" DAU TIEN trong doan HTML. */
export function findSold(htmlText) {
  const m = SOLD.exec(String(htmlText ?? "").replace(TAG, " "));
  return m ? parseSold(m[1] ?? m[2]) : "";
}

// ---------------------------------------------------------------------------
// Chuan hoa -> schema giong Tiki
// ---------------------------------------------------------------------------

function imageUrl(hash, thumb = false) {
  if (!hash) return "";
  if (String(hash).startsWith("http")) return hash;
  return `${CF_BASE}${hash}${thumb ? "_tn" : ""}`;
}

/** Shopee luu gia dang so nguyen x 100000. */
function toPrice(value) {
  if (isEmpty(value)) return "";
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? pyRound(n / 100000) : "";
}

function slug(text, maxLen = 80) {
  return String(text ?? "").toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen);
}

function productUrl(name, shopid, itemid, host) {
  const s = slug(name);
  if (s && shopid && itemid) return `https://${host}/${s}-i.${shopid}.${itemid}`;
  if (shopid && itemid) return `https://${host}/product/${shopid}/${itemid}`;
  return "";
}

function ratingStats(item) {
  const rating = item.item_rating || {};
  let star = rating.rating_star || item.rating_star || 0;
  const counts = rating.rating_count;
  const review = Array.isArray(counts) && counts.length
    ? counts.reduce((a, c) => a + parseInt(c, 10), 0)
    : item.cmt_count || item.review_count || 0;
  star = Number.isFinite(parseFloat(star)) ? pyRound(parseFloat(star), 2) : 0;
  return [star, review];
}

/** Nhan 1 entry ({item_basic: ...}) hoac 1 dict item -> 1 dong CSV. */
export function normalize(data, snapshotTs, host = "shopee.vn") {
  const item = ("item_basic" in data ? data.item_basic : data) || {};
  const itemid = item.itemid || item.item_id;
  const shopid = item.shopid || item.shop_id;

  const images = item.images || [];
  const mainHash = images.length ? images[0] : item.image;
  let allUrls = images.map((h) => imageUrl(h));
  if (!allUrls.length && mainHash) allUrls = [imageUrl(mainHash)];

  const price = toPrice(item.price);
  const original = toPrice(item.price_before_discount) || price;
  let discount = "";
  if (typeof price === "number" && typeof original === "number" && original > price) {
    discount = pyRound((1 - price / original) * 100, 2);
  }

  const [ratingStar, reviewCount] = ratingStats(item);

  const categories = item.categories || [];
  let categoryId = item.catid || "";
  if (!categoryId && categories.length) {
    const last = categories[categories.length - 1];
    categoryId = last && typeof last === "object" ? last.catid ?? "" : "";
  }

  const shop = item.shop || {};
  const sellerName = item.shop_name || (shop && typeof shop === "object" ? shop.name : "") || "";

  let brand = item.brand || "";
  if (brand && typeof brand === "object") brand = brand.name ?? "";

  const liked = item.liked_count ?? "";
  const breakdown = item.rating_breakdown || {};
  const reviews = item.reviews || [];

  const stars = {};
  for (const [key, val] of Object.entries(breakdown)) {
    const m = /^\s*(\d)\s*Sao/i.exec(key);
    if (m) stars[`rating_${m[1]}`] = val;
    else if (key.includes("Bình luận")) stars.review_with_comment = val;
    else if (key.includes("hình ảnh") || key.includes("video")) stars.review_with_media = val;
  }

  return {
    id: itemid,
    name: String(item.name || "").trim(),
    price,
    original_price: original,
    discount_rate: discount,
    rating_average: ratingStar,
    review_count: reviewCount,
    sold_count: item.sold ?? "",
    seller_id: shopid,
    seller_name: sellerName,
    brand_name: String(brand).trim(),
    category_id: categoryId,
    thumbnail_url: imageUrl(mainHash, true),
    main_image_url: imageUrl(mainHash),
    all_image_urls: pyJson(allUrls),
    url_path: productUrl(item.name || "", shopid, itemid, host),
    favourite_count: liked,
    created_at_snapshot: snapshotTs,
    shop_location: item.shop_location ?? "",
    stock: item.stock ?? "",
    liked_count: liked,
    ctime: item.ctime ?? "",
    description: item.description ?? "",
    rating_breakdown: Object.keys(breakdown).length ? pyJson(breakdown) : "",
    rating_5: stars.rating_5 ?? "",
    rating_4: stars.rating_4 ?? "",
    rating_3: stars.rating_3 ?? "",
    rating_2: stars.rating_2 ?? "",
    rating_1: stars.rating_1 ?? "",
    review_with_comment: stars.review_with_comment ?? "",
    review_with_media: stars.review_with_media ?? "",
    reviews: reviews.length ? pyJson(reviews) : "",
  };
}

/** Gop ban ghi listing voi ban ghi chi tiet (chi tiet uu tien). */
export function merge(base, detail) {
  const merged = { ...base };
  for (const [k, v] of Object.entries(detail)) if (!isEmpty(v)) merged[k] = v;
  return merged;
}

// ---------------------------------------------------------------------------
// Thong tin trang (URL goc tu dong "saved from url")
// ---------------------------------------------------------------------------

/** URL goc cua trang: comment "<!-- saved from url=(NNNN)URL -->" do Chrome/extension ghi. */
export function savedFromUrl(html) {
  const m = /<!--\s*saved from url=\(\d+\)(\S+?)\s*-->/.exec(String(html).slice(0, 4000));
  return m ? m[1] : "";
}

/** Thong tin extension ghi vao trang chi tiet luc cao: {keyword, page, rank, date} hoac null. */
export function crawlMeta(html) {
  const m = /<!--\s*shopee-crawler meta=(\S+)\s*-->/.exec(String(html).slice(0, 6000));
  if (!m) return null;
  try {
    return JSON.parse(decodeURIComponent(m[1]));
  } catch {
    return null;
  }
}

/** {keyword, page} neu la trang tim kiem (page tinh tu 1). */
export function searchInfo(url) {
  try {
    const u = new URL(url);
    if (!u.pathname.startsWith("/search")) return null;
    return {
      keyword: u.searchParams.get("keyword") || "",
      page: (parseInt(u.searchParams.get("page") || "0", 10) || 0) + 1,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Trang DANH SACH (listing)
// ---------------------------------------------------------------------------

const ANCHOR = /<a[^>]+href="https:\/\/shopee\.vn\/[^"]*?-i\.(\d+)\.(\d+)[^"]*?"/gi;
const HREF = /href="(https:\/\/shopee\.vn\/[^"]*?-i\.\d+\.\d+[^"]*?)"/gi;

function money(text) {
  if (!text) return null;
  const digits = text.replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) * 100000 : null;
}

const CARD = /<li\b[^>]*\bshopee-search-item-result__item\b[^>]*>/gi;

/**
 * Cac THE SAN PHAM trong luoi ket qua tim kiem (ul.shopee-search-item-result__items > li),
 * theo thu tu hien thi: [{html, rank}] (rank = vi tri the, 1..60).
 * Bo link SP nam NGOAI luoi (banner "shop lien quan" quang cao tren dau trang...).
 * null neu trang khong co luoi (vd file Ctrl+S kieu cu) -> dung moi link SP nhu truoc.
 */
export function listingCards(data) {
  const starts = [...data.matchAll(CARD)].map((m) => m.index);
  if (!starts.length) return null;
  return starts.map((start, i) => {
    // het the = </li> dong dung the (dem the li long nhau), khong vuot qua the ke tiep
    const limit = i + 1 < starts.length ? starts[i + 1] : data.length;
    const tag = /<(\/?)li\b[^>]*>/gi;
    tag.lastIndex = start;
    let depth = 0;
    let end = limit;
    for (let t = tag.exec(data); t && t.index < limit; t = tag.exec(data)) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) {
        end = t.index + t[0].length;
        break;
      }
    }
    return { html: data.slice(start, end), rank: i + 1 };
  });
}

/**
 * Thong ke luoi ket qua: cards = so the Shopee hien (thuong 60 / trang), placeholders = the
 * chua render (khung xam, chua co link), unique = so SP khac nhau (Shopee co the lap lai
 * SP quang cao), loginWall = trang bi cat o 40 SP + nut "Login to see more" (chua dang nhap).
 */
export function listingStats(data) {
  const cards = listingCards(data) || [];
  const ids = cards.map((c) => /-i\.\d+\.(\d+)/.exec(c.html)?.[1]).filter(Boolean);
  return {
    cards: cards.length,
    placeholders: cards.length - ids.length,
    unique: new Set(ids).size,
    loginWall: /Login to see more|Đăng nhập để xem thêm/i.test(data),
  };
}

/**
 * Danh sach entry {item_basic, rank} tu 1 trang listing (theo thu tu hien thi).
 * Trang co luoi ket qua: moi the 1 entry (the chua render bi bo, rank van theo vi tri the).
 */
export function parseListing(data) {
  const cards = listingCards(data);
  if (cards) {
    return cards.flatMap(({ html, rank }) => {
      const m = new RegExp(ANCHOR.source, "i").exec(html);
      return m ? [{ ...listingEntry(m, html.slice(m.index)), rank }] : [];
    });
  }
  const matches = [...data.matchAll(ANCHOR)];
  return matches.map((m, i) => {
    const end = i + 1 < matches.length ? matches[i + 1].index : data.length;
    return { ...listingEntry(m, data.slice(m.index, end)), rank: i + 1 };
  });
}

/** 1 entry tu link the SP (m = ket qua ANCHOR) va doan HTML cua the do. */
function listingEntry(m, chunk) {
  const [shopid, itemid] = [m[1], m[2]];

  const nm = /aria-label="View product:\s*(.*?)"/.exec(chunk) || /alt="(.*?)"/.exec(chunk);
  const name = nm ? unescapeHtml(nm[1]).trim() : "";

  // Anh chinh: image_ids trong link the SP (co san du anh chua lazy-load);
  // du phong: URL /file/ dau tien trong the (co the la khung/badge neu anh chua tai).
  const im = /image_ids=([a-zA-Z0-9_-]+)/.exec(m[0]) || /\/file\/([a-zA-Z0-9_-]+)/.exec(chunk);
  const image = im ? im[1] : "";

  const pm = /text-base\/5 font-medium">([\d.,]+)<\/span>/.exec(chunk);
  const price = pm ? money(pm[1]) : null;

  const dm = /aria-label="-(\d+)%"/.exec(chunk) || />-(\d+)%</.exec(chunk);
  const disc = dm ? parseInt(dm[1], 10) : 0;
  const original = price && disc > 0 && disc < 100
    ? pyRound(price / (1 - disc / 100)) : price || 0;

  return {
    item_basic: {
      itemid: Number(itemid),
      shopid: Number(shopid),
      name,
      image,
      price,
      price_before_discount: original,
      sold: findSold(chunk),
    },
  };
}

/**
 * URL trang chi tiet (da khu trung theo shopid.itemid) ~ extract_product_urls.py.
 * Trang co luoi ket qua: chi lay link trong cac the ket qua (bo banner quang cao ngoai luoi).
 */
export function extractProductUrls(data) {
  const cards = listingCards(data);
  if (cards) data = cards.map((c) => c.html).join("\n");
  const urls = new Map();
  for (const m of data.matchAll(HREF)) {
    const url = unescapeHtml(m[1]).split("?")[0];
    const key = /-i\.(\d+\.\d+)/.exec(url);
    if (key && !urls.has(key[1])) urls.set(key[1], url);
  }
  return [...urls.values()];
}

// ---------------------------------------------------------------------------
// Danh gia (reviews) render san trong DOM trang PDP
// ---------------------------------------------------------------------------

const WS = /\s+/g;
const CMTID = /data-cmtid="(\d+)"/g;
const MEDIA = /https:\/\/[^"\s]+susercontent\.com\/file\/[^"\s]+/g;

function clean(text) {
  return unescapeHtml(String(text ?? "").replace(TAG, " ")).replace(WS, " ").trim();
}

function firstInt(text) {
  const m = /\d+/.exec(text ?? "");
  return m ? parseInt(m[0], 10) : "";
}

function count(text) {
  let s = String(text ?? "").trim().toLowerCase().replace(/ /g, "");
  let mult = 1;
  if (s.endsWith("k")) { mult = 1000; s = s.slice(0, -1); }
  else if (s.endsWith("tr")) { mult = 1e6; s = s.slice(0, -2); }
  s = s.replace(/,/g, ".");
  if (!/^\s*[+-]?(\d+\.?\d*|\.\d+)\s*$/.test(s)) return s;
  return pyRound(parseFloat(s) * mult);
}

function ratingFromStars(chunk) {
  const m = /class="rGdC5O">([\s\S]*?)<\/div>/.exec(chunk);
  if (!m) return "";
  return m[1].split("icon-rating-solid").length - 1 || "";
}

function attributes(chunk) {
  const pairs = {};
  const re = /<span class="K5v3lN">([^<:]+):\s*<\/span>\s*<span>([^<]*)<\/span>/g;
  for (const [, label, value] of chunk.matchAll(re)) {
    const l = clean(label);
    if (l) pairs[l] = clean(value);
  }
  return pairs;
}

function media(chunk) {
  const out = [];
  for (const [url] of chunk.matchAll(MEDIA)) {
    const base = url.split("@")[0].replace(/\/+$/, "").replace(/\.(webp|jpe?g|png)$/, "");
    if (!out.includes(base)) out.push(base);
  }
  return out;
}

export function parseReviews(data) {
  const result = { rating_score: "", rating_breakdown: {}, reviews: [] };

  const sm = /product-rating-overview__rating-score[^>]*>([\d.,]+)</.exec(data);
  if (sm) {
    const v = parseFloat(sm[1].replace(",", "."));
    if (Number.isFinite(v)) result.rating_score = v;
  }

  const fre = /product-rating-overview__filter[^>]*>\s*<span>([^<]+?)\s*\(([^)]+)\)<\/span>/g;
  for (const [, label, raw] of data.matchAll(fre)) {
    result.rating_breakdown[clean(label)] = count(raw);
  }

  const positions = [...data.matchAll(CMTID)].map((m) => [m.index, m[1]]);
  positions.forEach(([pos, cmtid], i) => {
    const end = i + 1 < positions.length ? positions[i + 1][0] : pos + 8000;
    const chunk = data.slice(pos, end);

    const um = /class="InK5kS"[^>]*>([^<]+)</.exec(chunk);
    const user = um ? unescapeHtml(um[1]).trim() : "";
    const bm = /\/buyer\/(\d+)/.exec(chunk);
    const uid = firstInt(bm ? bm[1] : "");

    let time = "";
    let variant = "";
    const tm = /class="XYk98l">([\s\S]*?)<\/div>/.exec(chunk);
    if (tm) {
      const txt = clean(tm[1]);
      const idx = txt.indexOf("|");
      if (idx >= 0) { time = txt.slice(0, idx).trim(); variant = txt.slice(idx + 1).trim(); }
      else time = txt;
    }

    const cm = /class="YNedDV">([\s\S]*?)<\/div>/.exec(chunk);
    const sr = /class="QSiE2A">([\s\S]*?)<\/div>/.exec(chunk);
    const lc = /shopee-product-rating__like-count">([^<]*)</.exec(chunk);

    result.reviews.push({
      cmtid: Number(cmtid),
      user,
      userid: uid,
      rating: ratingFromStars(chunk),
      time,
      variant,
      attributes: attributes(chunk),
      comment: cm ? clean(cm[1]) : "",
      media: media(chunk),
      seller_response: sr ? clean(sr[1]) : "",
      helpful: firstInt(lc ? lc[1] : ""),
    });
  });
  return result;
}

// ---------------------------------------------------------------------------
// Trang CHI TIET (PDP)
// ---------------------------------------------------------------------------

const LD = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
const URLID = /-i\.(\d+)\.(\d+)/;
const IMG_ARRAY = /"images"\s*:\s*\[((?:"[^"]*")(?:\s*,\s*"[^"]*")*)\]/g;

const asList = (v) => (v === null || v === undefined ? [] : Array.isArray(v) ? v : [v]);

function ldBlocks(data) {
  const out = [];
  for (const [, raw] of data.matchAll(LD)) {
    try { out.push(JSON.parse(raw.trim())); } catch { /* bo qua khoi loi */ }
  }
  return out;
}

function findType(blocks, want) {
  for (const node of blocks) {
    let stack = Array.isArray(node) ? node : [node];
    if (node && typeof node === "object" && !Array.isArray(node) && "@graph" in node) stack = node["@graph"];
    for (const n of stack) {
      if (!n || typeof n !== "object") continue;
      const types = asList(n["@type"]);
      if (types.some((t) => String(t).toLowerCase() === want.toLowerCase())) return n;
    }
  }
  return null;
}

/** Gia trong ld+json la VND thuc ('282000.00') -> dang raw x100000. */
function ldPrice(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(/[^\d.]/g, "");
  const f = parseFloat(s);
  return s && Number.isFinite(f) ? Math.trunc(f) * 100000 : null;
}

function findImages(data, mainHash) {
  let best = [];
  for (const m of data.matchAll(IMG_ARRAY)) {
    const hashes = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    if (mainHash && hashes.includes(mainHash)) return hashes;
    if (hashes.length > best.length) best = hashes;
  }
  return best;
}

/** Trang co khoi ld+json Product (trang chi tiet) hay khong. */
export function isPdp(data) {
  return findType(ldBlocks(data), "Product") !== null;
}

/** 1 entry {item_basic} tu trang PDP, null neu khong phai PDP. */
export function parsePdp(data) {
  const blocks = ldBlocks(data);
  const prod = findType(blocks, "Product");
  if (!prod) return null;

  const name = unescapeHtml(String(prod.name ?? "")).trim();
  const desc = unescapeHtml(String(prod.description ?? "")).trim();
  const url = prod.url || "";

  let price = prod.offers ? ldPrice((asList(prod.offers)[0] || {}).price) : null;
  if (price === null && prod.offers && typeof prod.offers === "object" && !Array.isArray(prod.offers)) {
    price = ldPrice(prod.offers.price);
  }

  let rating = null;
  let reviews = null;
  const agg = prod.aggregateRating;
  if (agg && typeof agg === "object") {
    const r = parseFloat(agg.ratingValue);
    rating = Number.isFinite(r) ? r : null;
    reviews = strictInt(agg.reviewCount || agg.ratingCount);
  }

  let brand = prod.brand;
  if (brand && typeof brand === "object") brand = brand.name;

  const imageField = asList(prod.image);
  let mainHash = "";
  if (imageField.length) {
    let first = imageField[0];
    if (first && typeof first === "object") first = first.url;
    const hm = /\/file\/([a-zA-Z0-9_-]+)/.exec(String(first));
    mainHash = hm ? hm[1] : String(first);
  }

  let images = findImages(data, mainHash);
  if (!images.length && mainHash) images = [mainHash];

  let itemid = prod.productID || prod.sku;
  itemid = /^\d+$/.test(String(itemid)) ? Number(itemid) : null;
  const um = URLID.exec(url);
  if (itemid === null && um) itemid = Number(um[2]);
  const shopid = um ? Number(um[1]) : null;

  let catid = null;
  const bread = findType(blocks, "BreadcrumbList");
  if (bread) {
    const ids = [...JSON.stringify(bread).matchAll(/cat\.(\d+)/g)].map((x) => x[1]);
    if (ids.length) catid = Number(ids[ids.length - 1]);
  }
  if (catid === null) {
    const cm = /"catid"\s*:\s*(\d+)/.exec(data);
    catid = cm ? Number(cm[1]) : null;
  }

  // Ten shop: JSON nhung "shop_name" (khong phai trang nao cung co) -> du phong
  // ld+json Product.offers.seller.name (~40% trang PDP chi co o day).
  const sm = /"shop_name"\s*:\s*"([^"]+)"/.exec(data);
  let shopName = sm ? unescapeHtml(sm[1]) : "";
  if (!shopName) {
    const seller = asList(prod.offers).map((o) => o && o.seller && o.seller.name).find(Boolean);
    shopName = seller ? unescapeHtml(String(seller)).trim() : "";
  }

  // JSON nhung (so chinh xac) neu co; khong thi doc chu tren giao dien.
  const sm2 = /"(?:historical_sold|sold_count|sold)"\s*:\s*(\d+)/.exec(data);
  const sold = sm2 ? Number(sm2[1]) : findSold(data);

  const rv = parseReviews(data);
  if (rating === null && rv.rating_score !== "") rating = rv.rating_score;
  if (!reviews && Object.keys(rv.rating_breakdown).length) {
    reviews = Object.entries(rv.rating_breakdown)
      .filter(([k]) => k.includes("Sao"))
      .reduce((a, [, c]) => a + (typeof c === "number" ? c : 0), 0) || null;
  }

  return {
    item_basic: {
      itemid,
      shopid,
      name,
      image: mainHash,
      images,
      price,
      description: desc,
      rating_star: rating,
      item_rating: { rating_count: reviews ? [reviews] : null },
      catid,
      brand,
      shop_name: shopName,
      sold,
      rating_breakdown: rv.rating_breakdown,
      reviews: rv.reviews,
    },
  };
}

// ---------------------------------------------------------------------------
// CSV ~ pandas.to_csv(index=False, encoding="utf-8-sig")
// ---------------------------------------------------------------------------

function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? pyJson(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** bom=false cho file dua len repo chung (pandas doc BOM thanh ten cot "\ufeffid"). */
export function toCsv(records, extraColumns = [], { bom = true } = {}) {
  const seen = new Set();
  for (const r of records) for (const k of Object.keys(r)) seen.add(k);
  const order = [...BASE_COLUMNS, ...EXTRA_COLUMNS, ...extraColumns].filter((c) => seen.has(c));
  const cols = [...order, ...[...seen].filter((c) => !order.includes(c))];
  const lines = [cols.join(",")];
  for (const r of records) lines.push(cols.map((c) => csvCell(r[c])).join(","));
  return (bom ? "\ufeff" : "") + lines.join("\n") + "\n";
}
