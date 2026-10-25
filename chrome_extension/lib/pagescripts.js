// Ham duoc TIEM vao tab Shopee bang chrome.scripting.executeScript({func, args}).
// Phai tu chua (khong dung bien ngoai) vi Chrome chi chuyen ma nguon cua ham.

/**
 * Trang hien tai co bi chan (dang nhap / captcha) khong, va co dang HIEN tren man hinh khong.
 * visible = trang khong bi an VA trinh duyet dang ve khung hinh (requestAnimationFrame chay):
 * cua so thu nho / bi che kin / may khoa -> Chrome ngung ve -> Shopee khong lazy-load.
 */
export async function probePage() {
  // Trang dang nhap / trang /verify/ cua Shopee, hoac khung captcha noi tren trang (URL khong doi).
  const blockReason = () => {
    const path = location.pathname;
    if (/^\/(buyer\/login|account\/login)/.test(path)) return `đăng nhập (${path})`;
    if (/^\/verify\//.test(path)) return `captcha (${path})`;
    // chua dang nhap: trang tim kiem bi cat o 40 SP, thay phan trang bang nut "Login to see more"
    if (path === "/search" && [...document.querySelectorAll("button, a")].some((el) =>
      /^(Login to see more|Đăng nhập để xem thêm)$/i.test((el.textContent || "").trim()))) {
      return "đăng nhập (trang tìm kiếm chỉ hiện 40 sản phẩm + nút \"Login to see more\")";
    }
    const shown = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width >= 120 && r.height >= 60 && cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
    };
    for (const el of document.querySelectorAll('[id*="captcha" i], [class*="captcha" i], iframe[src*="captcha" i]')) {
      if (shown(el)) return "captcha (khung xác minh trên trang)";
    }
    return "";
  };
  const blocked = blockReason();
  const painting = await new Promise((resolve) => {
    let ok = false;
    requestAnimationFrame(() => { ok = true; resolve(true); });
    setTimeout(() => { if (!ok) resolve(false); }, 1000);
  });
  return { url: location.href, title: document.title, blocked, visible: document.visibilityState === "visible" && painting };
}

/**
 * Cho trang tai xong, cuon de Shopee render du noi dung, roi tra ve HTML (giong Ctrl+S).
 * kind = "listing" | "pdp"
 */
export async function capturePage(kind, opts) {
  const o = {
    timeoutMs: 25000, scrollDelayMs: 600, maxScrollMs: 90000, reviewWaitMs: 8000, scrollReviews: true,
    imageWaitMs: 15000, // tong thoi gian toi da cho anh lazy-load (thẻ SP / anh danh gia)
    expectedPerPage: 60, // Shopee hien dung 60 the SP / trang tim kiem (tru trang cuoi)
    maxNudges: 4, // so lan cuon len-xuong lai khi chua du
    cardIdleMs: 10000, // the khung xam: thoi gian toi da KHONG co them the nao hien thi dung cho
    cardMaxMs: 60000, // ... va tong thoi gian toi da cho the hien
    nudgeWaitMs: 3000, // cho moi lan
    ...opts,
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = (ms) => ms * (0.75 + Math.random() * 0.5);

  // Trang dang nhap / trang /verify/ cua Shopee, hoac khung captcha noi tren trang (URL khong doi).
  const blockReason = () => {
    const path = location.pathname;
    if (/^\/(buyer\/login|account\/login)/.test(path)) return `đăng nhập (${path})`;
    if (/^\/verify\//.test(path)) return `captcha (${path})`;
    // chua dang nhap: trang tim kiem bi cat o 40 SP, thay phan trang bang nut "Login to see more"
    if (path === "/search" && [...document.querySelectorAll("button, a")].some((el) =>
      /^(Login to see more|Đăng nhập để xem thêm)$/i.test((el.textContent || "").trim()))) {
      return "đăng nhập (trang tìm kiếm chỉ hiện 40 sản phẩm + nút \"Login to see more\")";
    }
    const shown = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width >= 120 && r.height >= 60 && cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
    };
    for (const el of document.querySelectorAll('[id*="captcha" i], [class*="captcha" i], iframe[src*="captcha" i]')) {
      if (shown(el)) return "captcha (khung xác minh trên trang)";
    }
    return "";
  };
  const blocked = blockReason;
  // Cua so bi an (thu nho, bi che kin, may khoa, dang o tab khac) -> dung, KHONG luu trang thieu.
  const isHidden = () => document.visibilityState === "hidden";
  const painting = () => new Promise((resolve) => {
    let ok = false;
    requestAnimationFrame(() => { ok = true; resolve(true); });
    setTimeout(() => { if (!ok) resolve(false); }, 1000);
  });
  const interrupted = () => {
    if (blocked()) return { blocked: blocked(), url: location.href };
    if (isHidden()) return { hidden: true, url: location.href };
    return null;
  };
  const bodyText = () => (document.body ? document.body.innerText || "" : "");
  const atBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 80;
  // cua so qua thap (thu nho/keo be) van cuon duoc, khong ket toi het han
  const viewH = () => Math.max(window.innerHeight, 600);

  const productIds = () => {
    const ids = new Set();
    for (const a of document.querySelectorAll('a[href*="-i."]')) {
      const m = /-i\.(\d+)\.(\d+)/.exec(a.getAttribute("href") || "");
      if (m) ids.add(m[2]);
    }
    return ids.size;
  };

  // Luoi ket qua (ul.shopee-search-item-result__items > li): the "san sang" = da render link SP.
  // The chua render la khung xam khong co link (Shopee chi ve khi the vao tam nhin).
  const gridCards = () => [...document.querySelectorAll("li.shopee-search-item-result__item")];
  const cardId = (li) => /-i\.\d+\.(\d+)/.exec(li.querySelector('a[href*="-i."]')?.getAttribute("href") || "")?.[1];
  const grid = () => {
    const cards = gridCards();
    const ids = cards.map(cardId).filter(Boolean);
    return { cards: cards.length, ready: ids.length, unique: new Set(ids).size };
  };

  /**
   * Cuon toi tung the con la khung xam (ca cot ben phai bi khuat ngang) va cho no render.
   * Cho toi khi moi the da co link; con the dang hien dan thi cho tiep, chi dung khi
   * idleMs lien khong them the nao (hoac qua maxMs).
   */
  const settleCards = async (idleMs, maxMs) => {
    const t0 = Date.now();
    let tProgress = t0;
    let best = grid().ready;
    while (Date.now() - t0 < maxMs && Date.now() - tProgress < idleMs) {
      const pending = gridCards().filter((x) => !cardId(x));
      if (!pending.length) return;
      for (const li of pending) {
        if (isHidden() || Date.now() - t0 > maxMs) return;
        if (!li.isConnected || cardId(li)) continue;
        li.scrollIntoView({ block: "center", inline: "center" });
        const t1 = Date.now();
        while (!cardId(li) && Date.now() - t1 < 1500) await sleep(150);
        const n = grid().ready;
        if (n > best) {
          best = n;
          tProgress = Date.now();
        }
      }
      await sleep(500);
    }
  };

  const hasLdProduct = () =>
    [...document.querySelectorAll('script[type="application/ld+json"]')].some((s) =>
      /"@type"\s*:\s*"Product"/.test(s.textContent || ""));

  // --- anh lazy-load ---------------------------------------------------------
  // Shopee de srcset="" cho toi khi anh vao tam nhin. "San sang" = da co URL anh that
  // (/file/<hash>) trong srcset/src — du de parser boc, khong can tai xong tung pixel.
  const REAL = /\/file\/[a-zA-Z0-9_-]+/;
  const imgReady = (img) =>
    REAL.test(img.getAttribute("srcset") || "") || REAL.test(img.getAttribute("src") || "")
    || REAL.test(img.currentSrc || "");

  /** Anh chinh cua tung the san pham (moi itemid 1 anh). */
  const cardImages = () => {
    const seen = new Map();
    for (const a of document.querySelectorAll('a[href*="-i."]')) {
      const m = /-i\.\d+\.(\d+)/.exec(a.getAttribute("href") || "");
      const img = m && !seen.has(m[1]) ? a.querySelector("img") : null;
      if (img) seen.set(m[1], img);
    }
    return [...seen.values()];
  };

  /** Anh / thumbnail video trong cac danh gia (bo anh cua khung phong to). */
  const reviewImages = () => [...document.querySelectorAll("[data-cmtid] img")].filter(
    (img) => !img.closest(".rating-media-list__zoomed-image") && !/zoomed-image-item|shopee-avatar/.test(img.className),
  );

  /**
   * Cuon toi tung anh chua san sang va cho (toi da 2 luot, trong budget).
   * Tra ve {total, missing} sau khi het luot.
   */
  const settleImages = async (getImgs, budgetMs) => {
    const t0 = Date.now();
    for (let pass = 0; pass < 2; pass++) {
      const pending = getImgs().filter((img) => !imgReady(img));
      if (!pending.length) break;
      for (const img of pending) {
        if (Date.now() - t0 > budgetMs) break;
        if (imgReady(img) || !img.isConnected) continue;
        img.scrollIntoView({ block: "center" });
        const t1 = Date.now();
        while (!imgReady(img) && Date.now() - t1 < 1500 && Date.now() - t0 < budgetMs) await sleep(150);
        if (isHidden()) break;
      }
      if (isHidden()) break;
      if (Date.now() - t0 > budgetMs) break;
      await sleep(600); // luot 2: cho cac anh vua kich hoat
    }
    const imgs = getImgs();
    return { total: imgs.length, missing: imgs.filter((img) => !imgReady(img)).length };
  };

  // HTML giong "Save as" cua Chrome: link/anh tuyet doi + dong "saved from url".
  const serialize = () => {
    const clone = document.documentElement.cloneNode(true);
    // anh lazy chua kich hoat: chep URL that tu data-src / data-srcset neu co
    for (const img of clone.querySelectorAll("img")) {
      for (const [from, to] of [["data-srcset", "srcset"], ["data-src", "src"]]) {
        const v = img.getAttribute(from);
        if (v && REAL.test(v) && !REAL.test(img.getAttribute(to) || "")) img.setAttribute(to, v);
      }
    }
    for (const [sel, attr] of [["a[href]", "href"], ["img[src]", "src"], ["link[href]", "href"]]) {
      for (const el of clone.querySelectorAll(sel)) {
        try {
          el.setAttribute(attr, new URL(el.getAttribute(attr), location.href).href);
        } catch { /* bo qua */ }
      }
    }
    const url = location.href;
    return `<!DOCTYPE html>\n<!-- saved from url=(${String(url.length).padStart(4, "0")})${url} -->\n${clone.outerHTML}`;
  };

  const done = (extra) => ({ url: location.href, title: document.title, html: serialize(), ...extra });
  // kiem tra lan cuoi: trang van dang duoc ve -> noi dung lazy-load da du -> moi chup
  const finish = async (extra) => {
    const stop = interrupted();
    if (stop) return stop;
    if (!(await painting())) return { hidden: true, url: location.href };
    return done(extra);
  };

  // 0) cua so dang bi an -> bao ngay, khoi mat cong cho
  if (blocked()) return { blocked: blocked(), url: location.href };
  if (isHidden() || !(await painting())) return { hidden: true, url: location.href };

  // 1) cho noi dung chinh xuat hien
  const t0 = Date.now();
  for (;;) {
    { const stop = interrupted(); if (stop) return stop; }
    if (kind === "listing" && productIds() > 0) break;
    if (kind === "pdp" && hasLdProduct()) break;
    const txt = bodyText();
    if (kind === "listing" && /Không tìm thấy kết quả|No results found|Không tìm thấy sản phẩm/i.test(txt)) {
      return done({ count: 0, empty: true });
    }
    if (kind === "pdp" && /Sản phẩm (này )?không tồn tại|product (does not|doesn't) exist/i.test(txt)) {
      return { url: location.href, missing: true };
    }
    if (Date.now() - t0 > o.timeoutMs) return { url: location.href, timeout: true };
    await sleep(500);
  }
  await sleep(jitter(1000));

  if (kind === "listing") {
    // 2a) cuon tu tu toi cuoi trang cho den khi so san pham khong tang nua
    let last = -1;
    let stable = 0;
    window.scrollTo(0, 0); // chay lai sau khi cua so hien lai: cuon lai tu dau
    const tScroll = Date.now();
    while (Date.now() - tScroll < o.maxScrollMs) {
      window.scrollBy(0, Math.round(viewH() * (0.55 + Math.random() * 0.3)));
      await sleep(jitter(o.scrollDelayMs));
      { const stop = interrupted(); if (stop) return stop; }
      const n = grid().ready || productIds();
      if (atBottom()) {
        stable = n === last ? stable + 1 : 0;
        if (stable >= 2) break;
      }
      last = n;
    }
    await sleep(jitter(800));

    // 2a') Shopee hien ~60 SP / trang va nap dot cuoi cham: toi cuoi trang ma chua du
    //      (va khong phai trang cuoi) -> cuon len 1 doan roi xuong lai, cho them; toi da vai luot.
    const totalPages = () => {
      const el = document.querySelector(".shopee-mini-page-controller__total");
      return el ? parseInt(el.textContent, 10) || null : null;
    };
    const pageNo = (parseInt(new URLSearchParams(location.search).get("page") || "0", 10) || 0) + 1;
    const lastPage = () => totalPages() !== null && pageNo >= totalPages();
    let nudges = 0;
    while (grid().cards < o.expectedPerPage && !lastPage() && nudges < o.maxNudges) {
      nudges += 1;
      const before = grid().cards;
      window.scrollBy(0, -Math.round(viewH() * 1.5));
      await sleep(jitter(700));
      window.scrollTo(0, document.documentElement.scrollHeight);
      const t1 = Date.now();
      while (grid().cards <= before && Date.now() - t1 < o.nudgeWaitMs) {
        await sleep(300);
        { const stop = interrupted(); if (stop) return stop; }
      }
    }

    // 3a) the con la khung xam (chua co link) -> cuon toi tung the va cho render
    await settleCards(o.cardIdleMs, o.cardMaxMs);
    { const stop = interrupted(); if (stop) return stop; }
    // 3b) anh the san pham chua kich hoat -> cuon lai tung the va cho
    const images = await settleImages(cardImages, o.imageWaitMs);
    // count = so THE trong luoi (thuong 60); ready = the da render; unique = SP khac nhau
    // (Shopee co the lap lai 1 SP quang cao o nhieu the)
    const g = grid();
    // short = chua du 60 the (tru trang cuoi) hoac con the chua hien -> crawler tai lai, giu ban nhieu the nhat
    const short = (g.cards < o.expectedPerPage && !lastPage()) || g.ready < g.cards;
    return finish({ count: g.cards, ready: g.ready, unique: g.unique, totalPages: totalPages(), images, nudges, short });
  }

  // 2b) PDP: cuon xuong khoi danh gia de Shopee render comment
  let reviews = 0;
  let images = { total: 0, missing: 0 };
  if (o.scrollReviews) {
    for (let i = 0; i < 40 && !document.querySelector(".product-ratings"); i++) {
      window.scrollBy(0, Math.round(viewH() * (0.6 + Math.random() * 0.3)));
      await sleep(jitter(o.scrollDelayMs));
      { const stop = interrupted(); if (stop) return stop; }
      if (atBottom()) break;
    }
    const box = document.querySelector(".product-ratings");
    if (box) {
      box.scrollIntoView({ block: "start" });
      const t1 = Date.now();
      while (Date.now() - t1 < o.reviewWaitMs) {
        reviews = document.querySelectorAll("[data-cmtid]").length;
        if (reviews > 0 || /chưa có đánh giá|no ratings yet/i.test(box.innerText || "")) break;
        { const stop = interrupted(); if (stop) return stop; }
        await sleep(400);
      }
      await sleep(jitter(800));
      reviews = document.querySelectorAll("[data-cmtid]").length;
      // 3b) anh/video trong danh gia (lazy-load) -> cho truoc khi chup
      images = await settleImages(reviewImages, Math.min(o.imageWaitMs, 10000));
    }
  }
  return finish({ reviews, images });
}
