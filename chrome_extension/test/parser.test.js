// node --test test/   (chay trong thu muc chrome_extension)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  crawlMeta, extractProductUrls, findSold, listingStats, parseListing, parseSold, pyJson, pyRound, savedFromUrl, searchInfo, toCsv, unescapeHtml,
} from "../lib/parser.js";
import { buildOutputs, outputFiles, parseFile } from "../lib/pipeline.js";
import { keywordId, parseCsv } from "../lib/registry.js";
import {
  MAX_SEARCH_PAGES, pageLimit, productLimit, safeName, sameTarget, searchUrl, stampTime, tagHtml,
} from "../lib/crawler-utils.js";

test("parseSold giong Python", () => {
  assert.equal(parseSold("10k+"), 10000);
  assert.equal(parseSold("1,6k"), 1600);
  assert.equal(parseSold("1,2tr"), 1200000);
  assert.equal(parseSold("1.234"), 1234);
  assert.equal(parseSold("282"), 282);
  assert.equal(parseSold("abc"), "");
  assert.equal(parseSold(""), "");
});

test("findSold bo qua gia tien", () => {
  assert.equal(findSold("<span>4.9</span> Đã bán 10k+"), 10000);
  assert.equal(findSold("2 Sold 584.364 ₫ ... 3k+ sold"), 3000);
  assert.equal(findSold("20k+ sold 3-5 Days"), 20000);
});

test("tien ich Python", () => {
  assert.equal(pyRound(2.5), 2);
  assert.equal(pyRound(3.5), 4);
  assert.equal(pyJson(["a", { b: 1 }]), '["a", {"b": 1}]');
  assert.equal(unescapeHtml("&amp;&quot;&#39;&#x1F600;"), "&\"'😀");
});

test("savedFromUrl + searchInfo", () => {
  const html = "<!DOCTYPE html>\n<!-- saved from url=(0049)https://shopee.vn/search?keyword=tai%20nghe&page=2 -->\n<html>";
  assert.equal(savedFromUrl(html), "https://shopee.vn/search?keyword=tai%20nghe&page=2");
  assert.deepEqual(searchInfo(savedFromUrl(html)), { keyword: "tai nghe", page: 3 });
  assert.equal(searchInfo("https://shopee.vn/abc-i.1.2"), null);
});

test("ten file + url tim kiem", () => {
  assert.equal(safeName('áo "thun" nam/nữ'), "áo_thun_namnữ");
  assert.equal(searchUrl("tai nghe", 1), "https://shopee.vn/search?keyword=tai%20nghe&page=0");
});

test("anh the SP chua lazy-load: lay image_ids, khong lay nham badge", () => {
  const card = (id, img) => `<a class="contents" aria-label="View product: SP ${id}" `
    + `href="https://shopee.vn/sp-${id}-i.1.${id}?extraParams=x&amp;image_ids=main-${id}">`
    + `<img class="lazyload" srcset="" src="">${img}</a>`;
  const badge = '<img src="https://down-vn.img.susercontent.com/file/badge-mall-frame">';
  const html = card(11, badge) + card(22, "");
  const [a, b] = parseListing(html);
  assert.equal(a.item_basic.image, "main-11");
  assert.equal(b.item_basic.image, "main-22");
  // the khong co image_ids -> du phong /file/ nhu truoc
  const [c] = parseListing('<a href="https://shopee.vn/x-i.1.33"><img srcset="https://x.susercontent.com/file/real-33@resize_w320 1x"></a>');
  assert.equal(c.item_basic.image, "real-33");
});

test("listing: chi lay the trong luoi ket qua, rank theo vi tri the", () => {
  const link = (id) => `<a class="contents" aria-label="View product: SP ${id}" href="https://shopee.vn/sp-i.1.${id}"><div>SP ${id}</div></a>`;
  const li = (inner) => `<li class="col-xs-2-4 shopee-search-item-result__item" data-sqe="item"><div>${inner}</div></li>`;
  const html = `<div class="banner">${link(901)}${link(902)}</div>` // shop quang cao ngoai luoi
    + `<ul class="row shopee-search-item-result__items">${li(link(1))}${li("<div>khung xam</div>")}${li(link(3))}${li(link(1))}</ul>`
    + "<button>Login to see more</button>";
  const entries = parseListing(html);
  assert.deepEqual(entries.map((e) => [e.item_basic.itemid, e.rank]), [[1, 1], [3, 3], [1, 4]]);
  assert.deepEqual(extractProductUrls(html), ["https://shopee.vn/sp-i.1.1", "https://shopee.vn/sp-i.1.3"]);
  assert.deepEqual(listingStats(html), { cards: 4, placeholders: 1, unique: 2, loginWall: true });
});

test("gioi han so trang / so san pham (o Tat ca)", () => {
  assert.equal(pageLimit({ pages: 3 }, null), 3);
  assert.equal(pageLimit({ pages: 3 }, 2), 2); // Shopee chi co 2 trang
  assert.equal(pageLimit({ pages: 3, pagesAll: true }, 17), 17);
  assert.equal(pageLimit({ pages: 3, pagesAll: true }, null), MAX_SEARCH_PAGES);
  assert.equal(productLimit({ maxProducts: 20 }), 20);
  assert.equal(productLimit({ maxProducts: 20, productsAll: true }), Infinity);
});

test("sameTarget: chup lai dung trang sau khi cua so hien lai", () => {
  const pdp = "https://shopee.vn/Tai-nghe-abc-i.557670769.29174299675";
  assert.ok(sameTarget(`${pdp}?extraParams=x&vItemId=1`, pdp)); // Shopee them tham so
  assert.ok(!sameTarget("https://shopee.vn/khac-i.1.2", pdp));
  const s1 = searchUrl("tai nghe", 2);
  assert.ok(sameTarget("https://shopee.vn/search?keyword=tai%20nghe&page=1&sortBy=relevancy", s1));
  assert.ok(!sameTarget(searchUrl("tai nghe", 3), s1));
  assert.ok(!sameTarget("about:blank", s1));
  assert.ok(!sameTarget("https://shopee.vn/buyer/login?next=x", pdp));
});

test("nhieu keyword -> moi keyword 1 thu muc, SP chung nam o ca 2 voi hang rieng", () => {
  const e = (id) => ({ item_basic: { itemid: id, shopid: 9, name: `SP ${id}`, image: `img${id}`, price: 10_000_000_000, price_before_discount: 10_000_000_000, sold: "" } });
  const parsed = [
    { kind: "listing", name: "search_tai_nghe_p01.html", keyword: "tai nghe", page: 1, entries: [e(1), e(2)], urls: [] },
    { kind: "listing", name: "search_Tai_Nghe_p02.html", keyword: "Tai Nghe", page: 2, entries: [e(4)], urls: [] }, // cung keyword, khac hoa/thuong
    { kind: "listing", name: "search_loa_p01.html", keyword: "loa bluetooth", page: 1, entries: [e(2), e(3)], urls: [] },
  ];
  const out = buildOutputs(parsed, "2026-10-23");
  const files = new Map(outputFiles(out, "2026-10-23").map((f) => [f.path, f.text]));
  const tn = files.get(`csv_processed/keywords/${keywordId("tai nghe")}/2026-10-23.csv`);
  const loa = files.get(`csv_processed/keywords/${keywordId("loa bluetooth")}/2026-10-23.csv`);
  assert.ok(tn && loa, [...files.keys()].join("\n"));
  assert.equal(tn.charCodeAt(0), 0xfeff); // file tren may co BOM cho Excel
  const rows = (csv) => parseCsv(csv).map((r) => [r.id, r.keyword, r.search_page, r.search_rank]);
  assert.deepEqual(rows(tn), [["1", "tai nghe", "1", "1"], ["2", "tai nghe", "1", "2"], ["4", "tai nghe", "2", "1"]]);
  assert.deepEqual(rows(loa), [["2", "loa bluetooth", "1", "1"], ["3", "loa bluetooth", "1", "2"]]);
  assert.ok(parseCsv(tn).every((r) => r.keyword_id === keywordId("tai nghe")));
  // file gop theo ngay van con
  assert.ok(files.has("csv_processed/shopee_final_2026-10-23.csv"));
});

test("ghi keyword vao trang chi tiet roi doc lai (ke ca keyword co -- va dau)", () => {
  const html = "<!DOCTYPE html>\n<!-- saved from url=(0030)https://shopee.vn/x-i.1.2 -->\n<html><body>x</body></html>";
  const meta = { keyword: "tai nghe -- không dây <b>", page: 2, rank: 7, date: "2026-10-23" };
  const tagged = tagHtml(html, meta);
  assert.deepEqual(crawlMeta(tagged), meta);
  assert.equal(savedFromUrl(tagged), "https://shopee.vn/x-i.1.2"); // dong saved-from van con
  assert.ok(!/<!--[^>]*--[^>]*-->/.test(tagged.split("\n")[2].slice(4, -3)), "khong duoc co -- trong comment");
  assert.equal(crawlMeta(html), null);
  assert.deepEqual(crawlMeta(tagHtml("<html></html>", { keyword: "a" })), { keyword: "a" }); // khong co saved-from
  assert.match(stampTime(new Date(2026, 9, 23, 9, 5, 7)), /^090507$/);
});

test("cao lai trong ngay: ban moi nhat thang, SP chi co o ban cu van giu keyword; PDP mo coi lay keyword tu tag", () => {
  const e = (id) => ({ item_basic: { itemid: id, shopid: 9, name: `SP ${id}`, image: "i", price: 10_000_000_000, price_before_discount: 10_000_000_000, sold: "" } });
  const pdp = (id, crawl) => ({ kind: "pdp", name: `pdp_9_${id}.html`, crawl, entry: { item_basic: { itemid: id, shopid: 9, name: `SP ${id}`, image: "i", images: ["i"], price: 10_000_000_000, reviews: [], rating_breakdown: {} } } });
  const parsed = [
    { kind: "listing", name: "search_tai_nghe_p01_153000.html", keyword: "tai nghe", page: 1, entries: [e(1), e(2), e(3)], urls: [] }, // ban cu
    { kind: "listing", name: "search_tai_nghe_p01_232000.html", keyword: "tai nghe", page: 1, entries: [e(3), e(1)], urls: [] }, // ban moi
    pdp(2, { keyword: "tai nghe", page: 1, rank: 2 }),
    pdp(9, { keyword: "tai nghe", page: 1, rank: 5 }), // trang tim kiem goc da mat
    pdp(8, null), // Ctrl+S thu cong: khong co keyword
  ];
  const out = buildOutputs(parsed, "2026-10-23");
  const rows = out.byKeyword.get("tai nghe").map((r) => [r.id, r.search_rank]);
  // 3 va 1 lay hang tu ban MOI (1, 2); 2 chi co o ban cu (hang 2); 9 lay tu tag (hang 5)
  assert.deepEqual(rows.sort((a, b) => a[0] - b[0]), [[1, 2], [2, 2], [3, 1], [9, 5]]);
  const f9 = out.final.find((r) => r.id === 9);
  assert.equal(f9.keyword, "tai nghe");
  assert.equal(out.final.find((r) => r.id === 8).keyword, "");
});

test("listing / detail cung tach theo keyword (kem raw + summary)", () => {
  const e = (id) => ({ item_basic: { itemid: id, shopid: 9, name: `SP ${id}`, image: "i", price: 10_000_000_000, price_before_discount: 12_000_000_000, sold: "" } });
  const pdp = (id, crawl) => ({ kind: "pdp", name: `pdp_9_${id}.html`, crawl, entry: { item_basic: { itemid: id, shopid: 9, name: `SP ${id}`, image: "i", images: ["i"], price: 10_000_000_000, description: `mo ta ${id}`, reviews: [], rating_breakdown: {} } } });
  const parsed = [
    { kind: "listing", name: "search_tai_nghe_p01.html", keyword: "tai nghe", page: 1, entries: [e(1), e(2)], urls: [] },
    { kind: "listing", name: "search_loa_p01.html", keyword: "loa", page: 1, entries: [e(2), e(3)], urls: [] },
    pdp(2, { keyword: "tai nghe", page: 1, rank: 2 }),
    pdp(9, { keyword: "tai nghe", page: 1, rank: 5 }), // chi co trang chi tiet
  ];
  const date = "2026-10-23";
  const files = new Map(outputFiles(buildOutputs(parsed, date), date).map((f) => [f.path, f.text]));
  const tn = `csv_processed/keywords/${keywordId("tai nghe")}/${date}`;
  const loa = `csv_processed/keywords/${keywordId("loa")}/${date}`;
  const ids = (p) => parseCsv(files.get(p)).map((r) => [r.id, r.search_rank]);
  // listing: chi SP thay tren trang tim kiem cua keyword
  assert.deepEqual(ids(`${tn}_listing.csv`), [["1", "1"], ["2", "2"]]);
  assert.deepEqual(ids(`${loa}_listing.csv`), [["2", "1"], ["3", "2"]]);
  // detail: chi SP co trang chi tiet, ke ca SP mo coi (9) va SP chung 2 keyword (2)
  assert.deepEqual(ids(`${tn}_detail.csv`), [["2", "2"], ["9", "5"]]);
  assert.deepEqual(ids(`${loa}_detail.csv`), [["2", "1"]]);
  assert.equal(parseCsv(files.get(`${tn}_detail.csv`))[0].description, "mo ta 2");
  assert.ok(parseCsv(files.get(`${tn}_listing.csv`)).every((r) => r.keyword === "tai nghe" && r.keyword_id === keywordId("tai nghe")));
  // final giu ten cu
  assert.deepEqual(ids(`${tn}.csv`), [["1", "1"], ["2", "2"], ["9", "5"]]);
  // raw + summary cho moi file
  assert.equal(JSON.parse(files.get(`${tn}_detail_raw.json`)).length, 2);
  assert.deepEqual(
    (({ rows, files_merged, keyword }) => ({ rows, files_merged, keyword }))(JSON.parse(files.get(`${tn}_listing_summary.json`))),
    { rows: 2, files_merged: 1, keyword: "tai nghe" },
  );
  assert.equal(JSON.parse(files.get(`${tn}_detail_summary.json`)).files_merged, 2);
  const fin = JSON.parse(files.get(`${tn}_summary.json`));
  assert.equal(fin.files_merged, 3);
  assert.equal(fin.with_detail, 2);
});

test("CSV co BOM, quote dung", () => {
  const csv = toCsv([{ id: 1, name: 'a,"b"\nc' }]);
  assert.ok(csv.startsWith("\ufeffid,name\n"));
  assert.ok(csv.includes('"a,""b""\nc"'));
  // kiem tra MA ky tu (khong so sanh chuoi co the bi doi giong nhau ca 2 ben)
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.equal(toCsv([{ id: 1 }], [], { bom: false }).charCodeAt(0), "i".charCodeAt(0));
});

// Du lieu mau that (bo qua neu khong co)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const sample = path.join(root, "crawl_manually", "2026-10-21");
test("du lieu mau 2026-10-21", { skip: !fs.existsSync(sample) }, () => {
  const names = fs.readdirSync(sample).filter((f) => f.endsWith(".html"));
  const parsed = names.map((n) => parseFile(n, fs.readFileSync(path.join(sample, n), "utf8")));
  const out = buildOutputs(parsed, "2026-10-21");
  assert.equal(out.detail.length, 5);
  assert.equal(out.listing.length, 23); // trang mau luu khi moi render 25 the (23 SP khac nhau)
  assert.equal(out.productUrls.length, 23);
  const ea230 = out.final.find((r) => r.id === 29174299675);
  assert.equal(ea230.has_detail, 1);
  assert.equal(ea230.keyword, "tai nghe không dây");
  assert.equal(ea230.brand_name, "Lenovo");
  assert.ok(ea230.reviews.length > 0);
  assert.equal(out.summary.final.with_detail, 5);
});
