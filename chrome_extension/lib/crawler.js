// Dieu phoi: tim keyword -> luu trang listing -> mo tung trang san pham -> luu PDP
// -> xu ly du lieu (CSV listing/detail/final) -> tai anh.
//
// Chay trong trang Dashboard (extension page). Moi trang Shopee duoc mo trong 1 TAB
// RIENG o cua so rieng (tab worker), dieu khien bang chrome.tabs + chrome.scripting
// (khong dung CDP/debugger). Trang thai job luu IndexedDB sau moi buoc -> dong
// Dashboard / tat may van "Tiep tuc" duoc.

import {
  localDate, pageLimit, productLimit, rand, safeName, sameTarget, searchUrl, setSavedFrom, stampTime, tagHtml,
} from "./crawler-utils.js";
import * as db from "./db.js";
import { capturePage, probePage } from "./pagescripts.js";
import { PARSE_VERSION, buildOutputs, keywordGroups, outputFiles, parseFile } from "./pipeline.js";

export const DEFAULTS = {
  pages: 1, // so trang ket qua / keyword
  pagesAll: false, // "Tat ca" trang ket qua
  maxProducts: 20, // so trang chi tiet toi da / keyword
  productsAll: false, // "Tat ca" san pham tim thay
  delayMin: 4, // nghi ngau nhien giua 2 lan mo trang (giay)
  delayMax: 9,
  breakEvery: 25, // cu N lan mo trang thi nghi dai
  breakMin: 45,
  breakMax: 90,
  fetchPdp: true,
  scrollReviews: true,
  skipOtherDays: false, // bo qua SP da co PDP o NGAY KHAC
  downloadImages: true,
  imageWait: 15, // giay toi da cho anh lazy-load tren 1 trang truoc khi luu
  listingRetries: 4, // trang tim kiem chua du 60 the: tai lai toi da N lan, luu ban nhieu the nhat
  alarm: true, // chuong keu lien tuc khi Shopee doi captcha / dang nhap
};

const JOB_KEY = "job";
const PRODUCT_RE = /-i\.(\d+)\.(\d+)/;

// --- hen gio khong bi ha toc khi tab an -------------------------------------
const timer = new Worker(chrome.runtime.getURL("lib/timer-worker.js"));
const waiters = new Map();
let seq = 0;
timer.onmessage = (e) => {
  waiters.get(e.data)?.();
  waiters.delete(e.data);
};
export function sleep(ms) {
  return new Promise((resolve) => {
    const id = ++seq;
    waiters.set(id, resolve);
    timer.postMessage({ id, ms });
  });
}

class Stopped extends Error {}

export class Crawler {
  constructor(store, { log, onChange, alarm = null }) {
    this.store = store;
    this.log = log;
    this.onChange = onChange;
    this.alarm = alarm; // lib/alarm.js (tuy chon)
    this.state = "idle"; // idle | running | paused | waiting-user | hidden
    this.job = null;
    this.tabId = null;
    this.windowId = null;
    this.stopReq = false;
    this.pauseReq = false;
    this.loads = 0;
    // bam vao thong bao (bi chan / cua so bi an) -> dua cua so Shopee len
    chrome.notifications.onClicked.addListener((id) => {
      if (id.startsWith("shopee-")) this.focusWorker();
    });
  }

  async loadJob() {
    this.job = (await db.get("kv", JOB_KEY)) || null;
    return this.job;
  }

  async save() {
    if (this.job) await db.put("kv", JOB_KEY, this.job);
    this.onChange?.();
  }

  setState(s) {
    this.state = s;
    this.onChange?.();
  }

  newJob(keywords, settings) {
    const uniq = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))];
    this.job = {
      date: localDate(),
      createdAt: new Date().toISOString(),
      status: "running",
      settings: { ...DEFAULTS, ...settings },
      keywords: uniq.map((keyword) => ({
        keyword, phase: "listing", nextPage: 1, totalPages: null, found: 0, queue: [],
      })),
      stats: { listingPages: 0, pdps: 0, skipped: 0, failed: 0, blocked: 0, hidden: 0 },
    };
    return this.job;
  }

  async clearJob() {
    this.job = null;
    await db.del("kv", JOB_KEY);
    this.onChange?.();
  }

  // --- dieu khien --------------------------------------------------------------
  pause() {
    if (["running", "waiting-user", "hidden"].includes(this.state)) {
      this.pauseReq = true;
      this.alarm?.mute(); // nguoi dung dang o may -> khoi keu
      this.setState("paused");
      this.log("Tạm dừng (sẽ dừng sau thao tác hiện tại).", "warn");
    }
  }

  resume() {
    if (this.pauseReq) {
      this.pauseReq = false;
      this.setState("running");
      this.log("Tiếp tục.", "info");
    }
  }

  stop() {
    this.stopReq = true;
    this.pauseReq = false;
    this.log("Đang dừng...", "warn");
  }

  async checkpoint() {
    if (this.stopReq) throw new Stopped();
    while (this.pauseReq) {
      await sleep(500);
      if (this.stopReq) throw new Stopped();
    }
  }

  async wait(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      await this.checkpoint();
      await sleep(Math.min(500, end - Date.now()));
    }
  }

  async politeDelay() {
    const s = this.job.settings;
    this.loads += 1;
    if (s.breakEvery > 0 && this.loads % s.breakEvery === 0) {
      const sec = rand(s.breakMin, s.breakMax);
      this.log(`Nghỉ dài ${Math.round(sec)}s sau ${this.loads} lần mở trang...`, "info");
      await this.wait(sec * 1000);
    } else {
      await this.wait(rand(s.delayMin, s.delayMax) * 1000);
    }
  }

  // --- tab worker ------------------------------------------------------------
  async ensureTab() {
    if (this.tabId !== null) {
      try {
        await chrome.tabs.get(this.tabId);
        return this.tabId;
      } catch {
        this.tabId = null;
      }
    }
    const win = await chrome.windows.create({ url: "about:blank", focused: true, width: 1280, height: 900 });
    this.windowId = win.id;
    this.tabId = win.tabs[0].id;
    this.log("Đã mở cửa sổ Shopee riêng — đừng thu nhỏ hay chuyển tab trong cửa sổ đó.", "info");
    await sleep(500);
    return this.tabId;
  }

  async navigate(url) {
    const tabId = await this.ensureTab();
    let listener;
    const loaded = new Promise((resolve) => {
      listener = (id, info) => {
        if (id === tabId && info.status === "complete") resolve();
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
    try {
      await chrome.tabs.update(tabId, { url });
      await Promise.race([loaded, sleep(45_000)]);
    } finally {
      chrome.tabs.onUpdated.removeListener(listener);
    }
  }

  async exec(func, args = []) {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: this.tabId }, func, args });
    return res?.result;
  }

  /** sticky = thong bao dung yen tren man hinh cho toi khi nguoi dung bam / extension xoa. */
  notify(title, message, id = "", sticky = false) {
    const opts = {
      type: "basic", iconUrl: chrome.runtime.getURL("icons/icon128.png"), title, message, priority: 2,
      requireInteraction: sticky,
    };
    if (id) chrome.notifications.create(id, opts);
    else chrome.notifications.create(opts);
  }

  /** Dua cua so Shopee len (bo thu nho, chon lai tab Shopee). */
  async focusWorker() {
    try {
      const win = await chrome.windows.get(this.windowId);
      if (win.state === "minimized") await chrome.windows.update(this.windowId, { state: "normal" });
      await chrome.windows.update(this.windowId, { focused: true });
      await chrome.tabs.update(this.tabId, { active: true });
    } catch { /* cua so da dong */ }
  }

  /**
   * Cua so Shopee co dang HIEN tren man hinh khong.
   * Thu nho -> false ngay (khong can hoi trang). Cua so bi dong -> mo lai, coi nhu hien.
   * Khong hoi duoc trang (vd about:blank) -> coi nhu hien; capturePage se tu kiem tra lai.
   */
  async windowVisible() {
    try {
      const win = await chrome.windows.get(this.windowId);
      if (win.state === "minimized") return false;
    } catch {
      this.tabId = null;
      await this.ensureTab();
      return true;
    }
    try {
      const p = await this.exec(probePage);
      return p ? !!p.visible : true;
    } catch {
      return true;
    }
  }

  /** Tam dung cho toi khi cua so Shopee hien lai (2 lan kiem tra lien tiep), roi chay tiep. */
  async waitForVisible() {
    this.job.stats.hidden = (this.job.stats.hidden || 0) + 1;
    if (!this.pauseReq) this.setState("hidden");
    this.log("Cửa sổ Shopee đang bị ẩn (thu nhỏ, bị che kín, máy khóa hoặc đang ở tab khác) — tạm dừng, "
      + "sẽ tự chạy tiếp khi cửa sổ hiện lại.", "warn");
    this.notify("Cửa sổ Shopee đang bị ẩn",
      "Extension đã tạm dừng để không lưu trang thiếu dữ liệu. Bấm vào đây để mở lại cửa sổ Shopee.", "shopee-hidden");
    const t0 = Date.now();
    let ok = 0;
    for (;;) {
      await sleep(2000);
      await this.checkpoint();
      ok = (await this.windowVisible()) ? ok + 1 : 0;
      if (ok >= 2) break;
    }
    chrome.notifications.clear("shopee-hidden");
    if (!this.pauseReq) this.setState("running");
    this.log(`Cửa sổ Shopee đã hiện lại sau ${Math.round((Date.now() - t0) / 1000)}s — chạy tiếp.`, "ok");
  }

  async waitForUser(reason) {
    this.job.stats.blocked += 1;
    this.setState("waiting-user");
    this.log(`Shopee yêu cầu đăng nhập / xác minh (${reason}). Hãy tự xử lý trong cửa sổ Shopee — extension sẽ tự chạy tiếp.`, "warn");
    this.notify("Shopee cần bạn giải captcha / đăng nhập",
      "Extension đã tạm dừng. Bấm vào đây để mở cửa sổ Shopee — xong là tự chạy tiếp.", "shopee-blocked", true);
    if (this.job.settings.alarm !== false && this.alarm) {
      this.alarm.start();
      await sleep(800); // AudioContext.resume() can mot chut
      if (this.alarm.blocked) this.log("Chrome chưa cho phát âm thanh — bấm \"Thử chuông\" trên Dashboard một lần để bật chuông.", "warn");
    }
    try {
      await chrome.windows.update(this.windowId, { focused: true, drawAttention: true });
    } catch { /* cua so da dong */ }
    try {
      for (;;) {
        await sleep(3000);
        await this.checkpoint();
        try {
          await chrome.tabs.get(this.tabId);
          const p = await this.exec(probePage);
          if (p && !p.blocked) break;
        } catch {
          await this.ensureTab();
          break;
        }
      }
    } finally {
      this.alarm?.stop(); // ke ca khi bam Dung
      chrome.notifications.clear("shopee-blocked");
    }
    if (!this.pauseReq) this.setState("running");
    this.log("Đã qua bước xác minh, chạy tiếp.", "ok");
  }

  /** Mo url, cho render, lay HTML. null neu that bai sau vai lan thu. */
  async capture(url, kind) {
    const s = this.job.settings;
    let failures = 0;
    let reload = true; // false: cua so vua hien lai, trang van con -> chup lai khong tai lai
    while (failures < 3) {
      await this.checkpoint();
      // dung mo trang vao cua so dang thu nho: cho truoc
      if (reload && !(await this.windowVisible())) await this.waitForVisible();
      if (!reload) {
        const tab = await chrome.tabs.get(this.tabId).catch(() => null);
        if (!tab || !sameTarget(tab.url || "", url)) reload = true; // nguoi dung da doi trang
      }
      let r;
      try {
        if (reload) await this.navigate(url);
        r = await this.exec(capturePage, [kind, {
          scrollReviews: s.scrollReviews,
          imageWaitMs: Math.max(0, Number(s.imageWait ?? DEFAULTS.imageWait)) * 1000,
        }]);
      } catch (e) {
        r = { error: String(e?.message || e) };
      }
      if (r?.blocked) {
        await this.waitForUser(r.blocked);
        reload = true;
        continue;
      }
      if (r?.hidden) {
        await this.waitForVisible(); // khong tinh la loi
        reload = false;
        continue;
      }
      reload = true;
      if (r?.html || r?.missing) return r;
      failures += 1;
      this.log(`lần ${failures}: ${r?.timeout ? "trang tải quá lâu" : r?.error || "không lấy được nội dung"}`, "warn");
      await this.wait(rand(5, 10) * 1000 * failures);
    }
    return null;
  }

  // --- luu + boc ---------------------------------------------------------------
  async saveHtml(name, html) {
    const date = this.job.date;
    await this.store.write(`crawl_manually/${date}/${name}`, html, "text/html;charset=utf-8");
    const parsed = parseFile(name, html);
    await db.put("parsed", `${date}/${name}`, parsed);
    return parsed;
  }

  /** itemid da co PDP luu theo ten pdp_<shop>_<item>.html, theo tung ngay. */
  async savedPdpIds() {
    const sameDay = new Set();
    const otherDays = new Set();
    for (const d of await this.store.list("crawl_manually")) {
      if (d.kind !== "directory" || !/^\d{4}-\d{2}-\d{2}$/.test(d.name)) continue;
      for (const f of await this.store.list(`crawl_manually/${d.name}`)) {
        const m = /^pdp_\d+_(\d+)\.html$/.exec(f.name);
        if (m) (d.name === this.job.date ? sameDay : otherDays).add(m[1]);
      }
    }
    // che do Downloads: dua vao nhung gi da boc trong IndexedDB
    for (const key of await db.keysByPrefix("parsed", `${this.job.date}/pdp_`)) {
      const m = /pdp_\d+_(\d+)\.html$/.exec(key);
      if (m) sameDay.add(m[1]);
    }
    return { sameDay, otherDays };
  }

  // --- chay job ----------------------------------------------------------------
  async run() {
    if (!this.job || this.state !== "idle") return;
    this.stopReq = false;
    this.pauseReq = false;
    this.loads = 0;
    this.job.status = "running";
    this.setState("running");
    const { date, settings } = this.job;
    this.log(`Bắt đầu ngày ${date}: ${this.job.keywords.length} keyword — lưu ${this.store.mode === "folder"
      ? `vào thư mục "${this.store.rootName}"` : `vào Downloads/${this.store.downloadSubdir}`}.`, "step");
    try {
      this.saved = await this.savedPdpIds();
      for (const kw of this.job.keywords) {
        if (kw.phase === "listing") await this.crawlListing(kw);
        if (kw.phase === "pdp") await this.crawlPdps(kw);
        if (kw.phase !== "done") {
          kw.phase = "done";
          await this.save();
        }
      }
      const missed = this.job.keywords.filter((k) => k.missedPages?.length);
      if (missed.length) {
        this.log(`Trang tìm kiếm chưa cào được: ${missed.map((k) => `"${k.keyword}" trang ${k.missedPages.join(", ")}`).join("; ")}`
          + " — hãy cào lại các keyword này.", "warn");
      }
      const out = await this.process(date, { images: settings.downloadImages });
      // vd tu day len GitHub — loi o day khong lam hong job da cao xong
      if (out && this.afterProcess) {
        try {
          await this.afterProcess(out, date);
        } catch (e) {
          this.log(`Không đẩy được lên GitHub: ${e?.message || e} — bấm "Đẩy lên GitHub" để thử lại.`, "error");
        }
      }
      this.job.status = "done";
      this.log("Hoàn tất!", "ok");
      this.notify("Cào Shopee xong", `Ngày ${date}: ${this.job.stats.listingPages} trang tìm kiếm, ${this.job.stats.pdps} trang sản phẩm.`);
    } catch (e) {
      if (e instanceof Stopped) {
        this.job.status = "stopped";
        this.log("Đã dừng. Bấm \"Tiếp tục job\" để chạy tiếp từ chỗ dừng.", "warn");
      } else {
        this.job.status = "error";
        this.log(`Lỗi: ${e?.message || e}`, "error");
        console.error(e);
      }
    } finally {
      this.stopReq = false;
      this.pauseReq = false;
      await this.save();
      this.setState("idle");
    }
  }

  queuedIds() {
    const ids = new Set();
    for (const k of this.job.keywords) for (const it of k.queue) ids.add(String(it.itemid));
    return ids;
  }

  async crawlListing(kw) {
    const s = this.job.settings;
    const queued = this.queuedIds();
    const maxProducts = productLimit(s);
    while (kw.nextPage <= pageLimit(s, kw.totalPages)) {
      const page = kw.nextPage;
      const url = searchUrl(kw.keyword, page);
      const total = s.pagesAll && !kw.totalPages ? "?" : pageLimit(s, kw.totalPages);
      this.log(`"${kw.keyword}" — trang ${page}/${total}`, "step");
      // chua du 60 the hoac con the chua hien -> tai lai trang (nghi lau dan), giu ban co
      // nhieu the da hien nhat; het luot van thieu VAN LUU ban do (co trang that su < 60 SP).
      // Tai lai ra dung ket qua cu -> coi la so the that cua trang, thoi tai lai.
      let r = await this.capture(url, "listing");
      const retries = Math.max(0, Number(s.listingRetries ?? DEFAULTS.listingRetries));
      for (let attempt = 1; r?.short && attempt <= retries; attempt++) {
        this.log(`mới có ${r.ready}/${r.count} thẻ đã hiện — tải lại trang để thử lấy thêm (lần ${attempt}/${retries}).`, "warn");
        await this.wait(rand(4, 8) * 1000 * attempt);
        const next = await this.capture(url, "listing");
        const same = next && next.count === r.count && next.ready === r.ready;
        if (next && (next.ready > r.ready || (next.ready === r.ready && next.count > r.count))) r = next;
        if (same) break;
      }
      if (r?.short) {
        this.log(`giữ bản nhiều thẻ nhất: ${r.ready}/${r.count} thẻ đã hiện (trang này có thể thật sự ít hơn 60 SP).`, "warn");
      }
      let stop = false;
      if (!r) {
        this.job.stats.failed += 1;
        (kw.missedPages ||= []).push(page); // chua cao duoc: cao lai keyword nay sau
        this.log("bỏ qua trang này.", "error");
      } else {
        if (r.totalPages) kw.totalPages = r.totalPages;
        // gio chup trong ten file: cao lai keyword trong ngay KHONG ghi de ban truoc
        const name = `search_${safeName(kw.keyword)}_p${String(page).padStart(2, "0")}_${stampTime()}.html`;
        const parsed = await this.saveHtml(name, setSavedFrom(r.html, url));
        this.job.stats.listingPages += 1;
        kw.found += parsed.entries.length;
        const rankOf = new Map();
        parsed.entries.forEach((e, idx) => { if (!rankOf.has(String(e.item_basic.itemid))) rankOf.set(String(e.item_basic.itemid), e.rank ?? idx + 1); });
        for (const u of parsed.urls) {
          if (kw.queue.length >= maxProducts) break;
          const m = PRODUCT_RE.exec(u);
          if (!m || queued.has(m[2])) continue;
          queued.add(m[2]);
          kw.queue.push({ url: u, shopid: m[1], itemid: m[2], status: "pending", page, rank: rankOf.get(m[2]) ?? "" });
        }
        // 60 the nhung it SP hon: Shopee lap lai SP quang cao o nhieu vi tri
        const st = parsed.stats;
        this.log(st?.cards
          ? `${st.cards} thẻ = ${st.unique} sản phẩm khác nhau${st.cards - st.placeholders > st.unique ? " (Shopee lặp lại SP quảng cáo)" : ""}`
            + `${st.placeholders ? `, ${st.placeholders} thẻ chưa hiện` : ""} → ${name}`
          : `${parsed.entries.length} sản phẩm → ${name}`, "ok");
        this.logImages(r.images, "ảnh thẻ sản phẩm", "đã lấy mã ảnh từ link thẻ (image_ids) thay thế");
        stop = r.empty || !parsed.entries.length;
      }
      kw.nextPage += 1;
      await this.save();
      if (stop) break;
      await this.politeDelay();
    }
    kw.phase = s.fetchPdp ? "pdp" : "done";
    await this.save();
  }

  async crawlPdps(kw) {
    const s = this.job.settings;
    const todo = kw.queue.filter((it) => it.status === "pending");
    let i = kw.queue.length - todo.length;
    for (const it of todo) {
      i += 1;
      const name = `pdp_${it.shopid}_${it.itemid}.html`;
      if (this.saved.sameDay.has(it.itemid) || (s.skipOtherDays && this.saved.otherDays.has(it.itemid))) {
        it.status = "skipped";
        this.job.stats.skipped += 1;
        await this.save();
        continue;
      }
      this.log(`"${kw.keyword}" — sản phẩm ${i}/${kw.queue.length} (${it.itemid})`, "step");
      const r = await this.capture(it.url, "pdp");
      if (!r || r.missing) {
        it.status = "failed";
        this.job.stats.failed += 1;
        this.log(`${r?.missing ? "sản phẩm không tồn tại" : "không lấy được trang"}`, "error");
      } else {
        // ghi keyword vao trang chi tiet -> luon biet SP thuoc keyword nao
        const tag = { keyword: kw.keyword, page: it.page ?? "", rank: it.rank ?? "", date: this.job.date };
        const parsed = await this.saveHtml(name, tagHtml(r.html, tag));
        it.status = parsed.kind === "pdp" ? "done" : "failed";
        if (it.status === "done") {
          this.job.stats.pdps += 1;
          this.saved.sameDay.add(it.itemid);
          const b = parsed.entry.item_basic;
          this.log(`${b.images.length} ảnh | ${b.reviews.length} đánh giá | ${b.name.slice(0, 50)}`, "ok");
          if (!b.images.length) this.log("trang không có danh sách ảnh sản phẩm", "warn");
          this.logImages(r.images, "ảnh trong đánh giá", "cột media của các đánh giá đó có thể thiếu");
        } else {
          this.job.stats.failed += 1;
          this.log("trang không có dữ liệu sản phẩm (ld+json)", "error");
        }
      }
      await this.save();
      await this.politeDelay();
    }
    kw.phase = "done";
    await this.save();
  }

  /** Bao cao anh lazy-load chua kich hoat kip sau khi da cho. */
  logImages(stats, what, consequence) {
    if (!stats?.missing) return;
    const sec = this.job.settings.imageWait ?? DEFAULTS.imageWait;
    this.log(`${stats.missing}/${stats.total} ${what} chưa tải kịp sau ${sec}s — ${consequence}.`, "warn");
  }

  // --- xu ly du lieu -------------------------------------------------------------
  /**
   * Boc + ghi CSV cho 1 ngay. Che do thu muc: doc moi file .html trong
   * crawl_manually/<ngay>/ (ke ca file Ctrl+S thu cong); force = boc lai tu dau.
   */
  async process(date, { images = false, force = false } = {}) {
    this.log(`Xử lý dữ liệu ngày ${date}...`, "step");
    let parsedList;
    if (this.store.mode === "folder") {
      const files = (await this.store.list(`crawl_manually/${date}`))
        .filter((f) => f.kind === "file" && /\.html?$/i.test(f.name));
      parsedList = [];
      for (const [idx, f] of files.entries()) {
        const key = `${date}/${f.name}`;
        let p = force ? null : await db.get("parsed", key);
        if (!p || p.v !== PARSE_VERSION) {
          p = parseFile(f.name, await this.store.readText(`crawl_manually/${date}/${f.name}`));
          await db.put("parsed", key, p);
        }
        parsedList.push(p);
        if ((idx + 1) % 20 === 0) this.log(`${idx + 1}/${files.length} file`, "info");
      }
    } else {
      parsedList = await db.getByPrefix("parsed", `${date}/`);
    }
    if (!parsedList.length) {
      this.log(`(ngày ${date} chưa có trang nào)`, "info");
      return null;
    }
    const out = buildOutputs(parsedList, date);
    for (const f of outputFiles(out, date)) {
      const type = f.path.endsWith(".csv") ? "text/csv;charset=utf-8"
        : f.path.endsWith(".json") ? "application/json" : "text/plain;charset=utf-8";
      await this.store.write(f.path, f.text, type);
    }
    this.log(`listing ${out.listing.length} · detail ${out.detail.length} · final ${out.final.length}`
      + ` (có chi tiết ${out.summary.final.with_detail}) → csv_processed/shopee_final_${date}.csv`, "ok");
    const groups = keywordGroups(out);
    if (groups.size) {
      const list = [...groups.values()].map((g) => `${g.keyword} (${g.rows.length})`).join(", ");
      this.log(`Tách theo keyword (final + listing + detail): ${groups.size} thư mục trong csv_processed/keywords/ — ${list}`, "ok");
    }
    if (images) await this.downloadImages(out.final, date);
    return out;
  }

  async downloadImages(records, date) {
    const dir = `image/${date}`;
    const have = new Set((await this.store.list(dir)).map((f) => f.name));
    for (const k of await db.keysByPrefix("images", `${date}/`)) have.add(k.slice(date.length + 1));
    const tasks = [];
    for (const r of records) {
      if (!r.id || !r.main_image_url) continue;
      const m = /\.(jpe?g|png|webp|gif)(\?|$)/i.exec(r.main_image_url);
      const name = `${r.id}_main.${m ? m[1].toLowerCase() : "jpg"}`;
      if (!have.has(name)) tasks.push({ url: r.main_image_url, name });
    }
    if (!tasks.length) {
      this.log("(ảnh đã đủ)", "info");
      return;
    }
    this.log(`Tải ${tasks.length} ảnh → ${dir}/`, "step");
    const stats = { ok: 0, fail: 0 };
    const failed = [];
    const worker = async () => {
      for (let t = tasks.shift(); t; t = tasks.shift()) {
        await this.checkpoint();
        const blob = await this.fetchImage(t.url);
        if (blob) {
          await this.store.write(`${dir}/${t.name}`, blob);
          if (this.store.mode !== "folder") await db.put("images", `${date}/${t.name}`, 1);
          stats.ok += 1;
        } else {
          stats.fail += 1;
          failed.push(t.name);
        }
        await sleep(rand(150, 400));
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    this.log(`ảnh: ok=${stats.ok} lỗi=${stats.fail}`, stats.fail ? "warn" : "ok");
    if (failed.length) {
      this.log(`ảnh lỗi: ${failed.slice(0, 5).join(", ")}${failed.length > 5 ? ` (+${failed.length - 5})` : ""}`
        + " — bấm \"Xử lý\" lần nữa để tải lại (ảnh đã có sẽ được bỏ qua).", "warn");
    }
  }

  /**
   * Tai 1 anh tu CDN: thu lai toi 3 lan moi host (cf.shopee.vn roi down-vn.img.susercontent.com),
   * chi nhan khi dung la anh (content-type image/*, > 1 KB) — tranh luu trang loi / anh rong.
   */
  async fetchImage(url) {
    const hash = url.split("/file/")[1];
    const urls = [url, ...(hash ? [`https://down-vn.img.susercontent.com/file/${hash}`] : [])];
    for (const u of urls) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(u, { cache: "no-store" });
          if (res.ok && (res.headers.get("content-type") || "").startsWith("image/")) {
            const blob = await res.blob();
            if (blob.size > 1024) return blob;
          } else if (res.status === 404) {
            break; // host nay khong co anh, thu host khac
          }
        } catch { /* loi mang: thu lai */ }
        await sleep(800 * (attempt + 1));
      }
    }
    return null;
  }
}
