// Xu ly 1 NGAY CAO: cac file .html -> listing / detail / final (thuan JS, test duoc bang Node).
//
// Tuong duong run_pipeline.py (buoc 2-4) nhung gop them 1 file FINAL:
//   shopee_listing_<ngay>  : moi san pham thay tren trang tim kiem
//   shopee_detail_<ngay>   : san pham co trang chi tiet (PDP)
//   shopee_final_<ngay>    : listing + chi tiet gop theo id (chi tiet uu tien)
//                            + keyword / search_page / search_rank / has_detail
//   keywords/<keyword_id>/<ngay>.csv : file final TACH THEO KEYWORD (cung cau truc voi
//                            repo GitHub cua nhom: data/<keyword_id>/<ngay>.csv)
//   keywords/<keyword_id>/<ngay>_listing.csv, <ngay>_detail.csv : listing / detail tach theo keyword
//   (moi CSV theo keyword kem _raw.json + _summary.json)

import {
  FINAL_COLUMNS,
  crawlMeta,
  extractProductUrls,
  listingStats,
  normalize,
  parseListing,
  parsePdp,
  savedFromUrl,
  searchInfo,
  toCsv,
} from "./parser.js";
import { keywordId, normalizeKeyword } from "./registry.js";

export const PREFIX = {
  listing: "shopee_listing",
  detail: "shopee_detail",
  final: "shopee_final",
};

// Tang khi doi cach boc -> ket qua boc cu luu trong IndexedDB bi bo, boc lai tu file .html
// (2: listing chi lay the trong luoi ket qua + rank theo vi tri the)
export const PARSE_VERSION = 2;

/** Phan loai + boc 1 file. Tra ve {kind: "pdp"|"listing", ...}. */
export function parseFile(name, text) {
  const pdp = parsePdp(text);
  // crawl: keyword/trang/thu hang extension ghi vao file luc cao (null voi file Ctrl+S)
  if (pdp && pdp.item_basic.itemid) return { kind: "pdp", v: PARSE_VERSION, name, entry: pdp, crawl: crawlMeta(text) };
  const info = searchInfo(savedFromUrl(text));
  return {
    kind: "listing",
    v: PARSE_VERSION,
    name,
    keyword: info?.keyword || "",
    page: info?.page || "",
    entries: parseListing(text),
    urls: extractProductUrls(text),
    stats: listingStats(text),
  };
}

function overlay(base, detail) {
  const out = { ...base };
  for (const [k, v] of Object.entries(detail)) {
    if (v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length)) out[k] = v;
  }
  // gia goc (truoc giam) chi co o listing: bo neu nho hon gia tren PDP
  if (out.price_before_discount && out.price && out.price_before_discount < out.price) {
    delete out.price_before_discount;
  }
  return out;
}

/**
 * parsed: ket qua parseFile() cua tung file trong ngay.
 * Tra ve {listing, detail, final, productUrls, summary}.
 */
export function buildOutputs(parsed, date) {
  const cards = new Map(); // itemid -> item_basic (listing)
  const meta = new Map(); // itemid -> {keywords:Set, page, rank}
  const details = new Map(); // itemid -> item_basic (pdp)
  const urls = new Map();
  const kwFiles = new Map(); // keyword -> {listing:Set(ten file), pdp:Set(ten file)}
  const kwFileSet = (kw, kind) => {
    if (!kwFiles.has(kw)) kwFiles.set(kw, { listing: new Set(), pdp: new Set() });
    return kwFiles.get(kw)[kind];
  };
  let listingFiles = 0;
  let pdpFiles = 0;

  // listing truoc: sap theo keyword + trang; cung trang co nhieu ban chup (cao lai trong ngay,
  // ten file co gio: search_<kw>_p01_233012.html) -> ban MOI NHAT truoc de gia/thu hang moi nhat
  // duoc giu, SP chi co o ban cu van giu keyword.
  const listings = parsed.filter((p) => p.kind === "listing")
    .sort((a, b) => (a.keyword || "").localeCompare(b.keyword || "") || (a.page || 0) - (b.page || 0)
      || b.name.localeCompare(a.name));
  for (const p of listings) {
    listingFiles += 1;
    if (p.keyword) kwFileSet(p.keyword, "listing").add(p.name);
    p.entries.forEach((e, idx) => {
      const id = e.item_basic.itemid;
      const rank = e.rank ?? idx + 1; // vi tri the tren trang tim kiem
      if (!cards.has(id)) cards.set(id, e.item_basic);
      const m = meta.get(id) || { keywords: new Set(), page: p.page, rank, byKw: new Map() };
      if (p.keyword) {
        m.keywords.add(p.keyword);
        // thu hang theo TUNG keyword (1 SP co the nam o nhieu keyword voi hang khac nhau);
        // listed: SP thay tren trang tim kiem cua keyword nay (-> co dong trong listing theo keyword)
        if (!m.byKw.has(p.keyword)) m.byKw.set(p.keyword, { page: p.page, rank, listed: true });
      }
      meta.set(id, m);
    });
    for (const u of p.urls) {
      const key = /-i\.(\d+\.\d+)/.exec(u)[1];
      if (!urls.has(key)) urls.set(key, u);
    }
  }
  for (const p of parsed.filter((x) => x.kind === "pdp")) {
    pdpFiles += 1;
    const id = p.entry.item_basic.itemid;
    if (!details.has(id)) details.set(id, p.entry.item_basic);
    // keyword ghi trong trang chi tiet: dung khi trang tim kiem goc khong con
    const kw = p.crawl?.keyword;
    if (kw) {
      const m = meta.get(id) || { keywords: new Set(), page: p.crawl.page ?? "", rank: p.crawl.rank ?? "", byKw: new Map() };
      m.keywords.add(kw);
      if (!m.byKw.has(kw)) m.byKw.set(kw, { page: p.crawl.page ?? "", rank: p.crawl.rank ?? "" });
      meta.set(id, m);
    }
  }
  // trang chi tiet thuoc moi keyword ma SP do nam trong
  for (const p of parsed.filter((x) => x.kind === "pdp")) {
    for (const kw of meta.get(p.entry.item_basic.itemid)?.byKw.keys() || []) kwFileSet(kw, "pdp").add(p.name);
  }

  const listing = [...cards.values()].map((b) => normalize({ item_basic: b }, date));
  const detail = [...details.values()].map((b) => normalize({ item_basic: b }, date));
  const listingRows = new Map([...cards.keys()].map((id, i) => [id, listing[i]]));
  const detailRows = new Map([...details.keys()].map((id, i) => [id, detail[i]]));

  const ids = [...cards.keys(), ...[...details.keys()].filter((id) => !cards.has(id))];
  const final = ids.map((id) => {
    const base = cards.get(id) || {};
    const det = details.get(id);
    const row = normalize({ item_basic: det ? overlay(base, det) : base }, date);
    const m = meta.get(id);
    return {
      ...row,
      keyword: m ? [...m.keywords].join("|") : "",
      search_page: m?.page ?? "",
      search_rank: m?.rank ?? "",
      has_detail: det ? 1 : 0,
    };
  });

  // Tach theo keyword: moi SP xuat hien o keyword nao thi co 1 dong trong keyword do,
  // voi search_page / search_rank cua chinh keyword do. Lam cho ca final, listing va detail:
  // listing chi gom SP thay tren trang tim kiem cua keyword, detail chi gom SP co trang chi tiet.
  const byKeyword = new Map();
  const listingByKeyword = new Map();
  const detailByKeyword = new Map();
  const push = (map, kw, row) => {
    if (!map.has(kw)) map.set(kw, []);
    map.get(kw).push(row);
  };
  final.forEach((row, i) => {
    const id = ids[i];
    const m = meta.get(id);
    if (!m) return;
    for (const [kw, pos] of m.byKw) {
      const at = { keyword: kw, search_page: pos.page, search_rank: pos.rank };
      push(byKeyword, kw, { ...row, ...at });
      if (pos.listed) push(listingByKeyword, kw, { ...listingRows.get(id), ...at });
      if (detailRows.has(id)) push(detailByKeyword, kw, { ...detailRows.get(id), ...at });
    }
  });
  for (const map of [byKeyword, listingByKeyword, detailByKeyword]) {
    for (const rows of map.values()) {
      rows.sort((a, b) => (a.search_page || 0) - (b.search_page || 0) || a.search_rank - b.search_rank);
    }
  }

  const createdAt = new Date().toISOString();
  const summary = (rows, files) => ({ rows: rows.length, files_merged: files, crawl_date: date, created_at: createdAt });
  return {
    listing,
    detail,
    final,
    byKeyword,
    listingByKeyword,
    detailByKeyword,
    kwFiles,
    createdAt,
    productUrls: [...urls.values()],
    summary: {
      listing: summary(listing, listingFiles),
      detail: summary(detail, pdpFiles),
      final: {
        ...summary(final, listingFiles + pdpFiles),
        with_detail: final.filter((r) => r.has_detail).length,
        keywords: [...new Set(final.flatMap((r) => (r.keyword ? r.keyword.split("|") : [])))],
      },
    },
  };
}

const BY_KEYWORD = { final: "byKeyword", listing: "listingByKeyword", detail: "detailByKeyword" };

/**
 * Gom file final / listing / detail theo keyword_id ("Tai nghe" va "tai nghe" la 1),
 * moi SP 1 dong / keyword. Tra ve Map keyword_id -> {keyword, rows, files};
 * moi dong co them cot keyword_id, files = so file .html da gop cho keyword do.
 */
export function keywordGroups(out, kind = "final") {
  const groups = new Map();
  for (const [kw, rows] of out[BY_KEYWORD[kind]] || []) {
    const keyword = normalizeKeyword(kw);
    const id = keywordId(keyword);
    const g = groups.get(id) || { keyword, rows: [], seen: new Set(), names: new Set() };
    for (const r of rows) {
      if (g.seen.has(r.id)) continue;
      g.seen.add(r.id);
      g.rows.push({ ...r, keyword, keyword_id: id });
    }
    const f = out.kwFiles?.get(kw);
    if (f) {
      if (kind !== "detail") f.listing.forEach((n) => g.names.add(n));
      if (kind !== "listing") f.pdp.forEach((n) => g.names.add(n));
    }
    groups.set(id, g);
  }
  for (const g of groups.values()) {
    g.files = g.names.size;
    delete g.seen;
    delete g.names;
  }
  return groups;
}

export const KEYWORD_COLUMNS = [...FINAL_COLUMNS, "keyword_id"];
const KEYWORD_SUFFIX = { final: "", listing: "_listing", detail: "_detail" };
const keywordBase = (id, date, kind = "final") => `csv_processed/keywords/${id}/${date}${KEYWORD_SUFFIX[kind]}`;
export const keywordCsvPath = (id, date, kind = "final") => `${keywordBase(id, date, kind)}.csv`;

/** Danh sach file can ghi ra csv_processed/ : [{path, text}] (path tuong doi goc du an). */
export function outputFiles(out, date) {
  const files = [];
  for (const kind of ["listing", "detail", "final"]) {
    const rows = out[kind];
    if (!rows.length) continue;
    const base = `csv_processed/${PREFIX[kind]}_${date}`;
    files.push({ path: `${base}.csv`, text: toCsv(rows, kind === "final" ? FINAL_COLUMNS : []) });
    files.push({ path: `${base}_raw.json`, text: JSON.stringify(rows, null, 2) });
    files.push({ path: `${base}_summary.json`, text: JSON.stringify(out.summary[kind], null, 2) });
  }
  // moi keyword 1 thu muc, moi ngay: final (<ngay>.csv) + <ngay>_listing.csv + <ngay>_detail.csv
  for (const kind of ["final", "listing", "detail"]) {
    for (const [id, g] of keywordGroups(out, kind)) {
      const base = keywordBase(id, date, kind);
      const sum = {
        rows: g.rows.length,
        files_merged: g.files,
        crawl_date: date,
        created_at: out.createdAt,
        keyword: g.keyword,
        keyword_id: id,
      };
      if (kind === "final") sum.with_detail = g.rows.filter((r) => r.has_detail).length;
      files.push({ path: `${base}.csv`, text: toCsv(g.rows, KEYWORD_COLUMNS) });
      files.push({ path: `${base}_raw.json`, text: JSON.stringify(g.rows, null, 2) });
      files.push({ path: `${base}_summary.json`, text: JSON.stringify(sum, null, 2) });
    }
  }
  if (out.productUrls.length) {
    files.push({ path: `crawl_manually/${date}/product_urls.txt`, text: out.productUrls.join("\n") });
  }
  return files;
}
