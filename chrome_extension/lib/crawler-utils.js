// Tien ich cua crawler khong phu thuoc chrome.* (test duoc bang Node).

export function localDate(d = new Date()) {
  return d.toLocaleDateString("sv-SE"); // YYYY-MM-DD theo gio may
}

/** Ten file an toan tren Windows, giu tieng Viet. */
export function safeName(text, max = 60) {
  return String(text).normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .trim().replace(/\s+/g, "_").slice(0, max) || "keyword";
}

/** URL trang tim kiem; page tinh tu 1 (Shopee dem tu 0). */
export function searchUrl(keyword, page) {
  return `https://shopee.vn/search?keyword=${encodeURIComponent(keyword)}&page=${page - 1}`;
}

/** Gio:phut:giay luc chup -> "233012" (ten file trang tim kiem khong ghi de nhau khi cao lai). */
export function stampTime(d = new Date()) {
  return d.toLocaleTimeString("sv-SE", { hour12: false }).replace(/:/g, "");
}

/**
 * Ghi keyword (+ trang, thu hang) vao chinh file HTML trang chi tiet, ngay sau dong
 * "saved from url": <!-- shopee-crawler meta=%7B...%7D -->. Nho vay SP luon biet minh thuoc
 * keyword nao, ke ca khi trang tim kiem goc khong con. Doc lai bang parser.crawlMeta().
 */
export function tagHtml(html, meta) {
  const line = `<!-- shopee-crawler meta=${encodeURIComponent(JSON.stringify(meta))} -->`;
  const m = /<!--\s*saved from url=\(\d+\)\S+?\s*-->/.exec(html);
  if (m) return `${html.slice(0, m.index + m[0].length)}\n${line}${html.slice(m.index + m[0].length)}`;
  return html.replace(/^(<!DOCTYPE[^>]*>)?/i, (dt) => `${dt}\n${line}`);
}

/** Thay dong "saved from url" (de file listing luon mang dung keyword + trang). */
export function setSavedFrom(html, url) {
  const line = `<!-- saved from url=(${String(url.length).padStart(4, "0")})${url} -->`;
  return html.replace(/<!--\s*saved from url=\(\d+\)\S+?\s*-->/, line);
}

// "Tat ca" trang: chay toi trang cuoi Shopee bao (thuong 17); khong doc duoc thi dung o day.
export const MAX_SEARCH_PAGES = 50;

/** So trang ket qua se cao cho 1 keyword (ton trong o "Tat ca" + tong trang that). */
export function pageLimit(settings, totalPages) {
  const want = settings.pagesAll ? MAX_SEARCH_PAGES : settings.pages;
  return Math.min(want, totalPages || want);
}

/** So trang chi tiet toi da / keyword (Infinity neu chon "Tat ca"). */
export function productLimit(settings) {
  return settings.productsAll ? Infinity : settings.maxProducts;
}

/**
 * Tab van dang o dung trang can chup? (de chup lai khong can tai lai sau khi cua so hien lai)
 * PDP: cung shopid.itemid; trang tim kiem: cung keyword + page.
 */
export function sameTarget(current, target) {
  try {
    const a = new URL(current);
    const b = new URL(target);
    if (a.host !== b.host) return false;
    const pa = /-i\.(\d+\.\d+)/.exec(a.pathname);
    const pb = /-i\.(\d+\.\d+)/.exec(b.pathname);
    if (pa || pb) return !!pa && !!pb && pa[1] === pb[1];
    return a.pathname === b.pathname
      && a.searchParams.get("keyword") === b.searchParams.get("keyword")
      && (a.searchParams.get("page") || "0") === (b.searchParams.get("page") || "0");
  } catch {
    return false;
  }
}

export function rand(min, max) {
  return min + Math.random() * Math.max(0, max - min);
}
