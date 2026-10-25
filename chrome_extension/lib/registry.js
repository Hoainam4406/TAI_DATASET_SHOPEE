// Danh sach keyword dung chung cua nhom (keywords.csv trong repo GitHub) — thuan JS, test bang Node.
//
// Moi keyword co 1 keyword_id co dinh: slug khong dau + 4 ky tu hash cua keyword (co dau),
// vd "tai nghe không dây" -> "tai-nghe-khong-day-ab2d". Du lieu cua keyword nam o
//   data/<keyword_id>/<YYYY-MM-DD>.csv
// nen khong bao gio ghi de nhau; cao lai cung ngay thi thay bang ban moi.
// (Python: team_dataset/common.py dung CUNG thuat toan.)

import { pyJson } from "./parser.js";

export const REGISTRY_PATH = "keywords.csv";
export const REGISTRY_COLUMNS = ["keyword_id", "keyword", "group", "status", "claimed_at", "done_at", "rows"];
export const STALE_HOURS = 48; // "in_progress" qua lau -> tra ve cho nguoi khac nhan

/** Viet thuong, chuan Unicode NFC, gop khoang trang: "Tai nghe  Không dây " -> "tai nghe không dây". */
export function normalizeKeyword(text) {
  return String(text ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

function fnv1a32(text) {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(text)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** "tai nghe không dây" -> "tai-nghe-khong-day-xxxx" (hash giu "bàn" va "bán" khac nhau). */
export function keywordId(text) {
  const norm = normalizeKeyword(text);
  const slug = norm.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || "kw";
  const hash = fnv1a32(norm).toString(16).padStart(8, "0").slice(0, 4);
  return `${slug}-${hash}`;
}

// --- CSV nho (co ho tro "..." co dau phay / xuong dong) ------------------------------
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const s = String(text ?? "").replace(/^\ufeff/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const [header = [], ...body] = rows.filter((r) => r.some((x) => x !== ""));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const cell = (v) => {
  const t = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export function serializeRegistry(reg) {
  return [REGISTRY_COLUMNS.join(","), ...reg.map((r) => REGISTRY_COLUMNS.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}

export function parseRegistry(text) {
  return parseCsv(text).map((r) => {
    const out = Object.fromEntries(REGISTRY_COLUMNS.map((c) => [c, r[c] ?? ""]));
    if (!out.keyword_id && out.keyword) out.keyword_id = keywordId(out.keyword);
    if (!out.status) out.status = "todo";
    return out;
  });
}

export function registryCounts(reg) {
  const c = { todo: 0, in_progress: 0, done: 0, total: reg.length };
  for (const r of reg) c[r.status] = (c[r.status] || 0) + 1;
  return c;
}

const stale = (r, now) => r.status === "in_progress"
  && (!r.claimed_at || now - Date.parse(r.claimed_at) > STALE_HOURS * 3600_000);

/** Nhan toi da n keyword dang trong (todo, hoac in_progress qua han). Sua reg tai cho. */
export function claimKeywords(reg, n, now = Date.now()) {
  const picked = [];
  for (const r of reg) {
    if (picked.length >= n) break;
    if (r.status === "todo" || stale(r, now)) {
      r.status = "in_progress";
      r.claimed_at = new Date(now).toISOString();
      picked.push(r);
    }
  }
  return picked;
}

/** Them keyword moi (bo qua cai da co theo keyword_id). Tra ve danh sach da them. */
export function addKeywords(reg, keywords, group = "") {
  const have = new Set(reg.map((r) => r.keyword_id));
  const added = [];
  for (const k of keywords) {
    const keyword = normalizeKeyword(k);
    if (!keyword) continue;
    const id = keywordId(keyword);
    if (have.has(id)) continue;
    have.add(id);
    const r = { keyword_id: id, keyword, group, status: "todo", claimed_at: "", done_at: "", rows: "" };
    reg.push(r);
    added.push(r);
  }
  return added;
}

/** Danh dau da xong (them vao neu chua co trong danh sach). done = {keyword_id: {keyword, rows}} */
export function markDone(reg, done, now = Date.now()) {
  const byId = new Map(reg.map((r) => [r.keyword_id, r]));
  for (const [id, { keyword, rows }] of Object.entries(done)) {
    let r = byId.get(id);
    if (!r) {
      r = { keyword_id: id, keyword, group: "", status: "", claimed_at: "", done_at: "", rows: "" };
      reg.push(r);
      byId.set(id, r);
    }
    r.status = "done";
    r.done_at = new Date(now).toISOString();
    r.rows = rows;
  }
}

// --- an danh nguoi mua trong cot reviews ----------------------------------------------
async function sha256Hex(text) {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Thay ten / ID nguoi mua trong cot `reviews` bang ma bam ("u_" + 12 ky tu sha256).
 * Cung 1 nguoi -> cung 1 ma (van dung duoc cho RecSys), nhung khong con ten that.
 */
export async function anonymizeReviews(rows) {
  const cache = new Map();
  const hash = async (v) => {
    const key = String(v);
    if (!cache.has(key)) cache.set(key, `u_${(await sha256Hex(`shopee-user:${key}`)).slice(0, 12)}`);
    return cache.get(key);
  };
  const out = [];
  for (const row of rows) {
    if (!row.reviews) { out.push(row); continue; }
    let list;
    try { list = JSON.parse(row.reviews); } catch { out.push(row); continue; }
    for (const rv of list) {
      // userid = 0 / "" khi Shopee an danh san -> giu nguyen; con lai bam theo ID (on dinh hon ten)
      const uid = rv.userid && rv.userid !== 0 ? rv.userid : "";
      const anon = uid ? await hash(`id:${uid}`) : rv.user ? await hash(`name:${rv.user}`) : "";
      rv.user = anon;
      rv.userid = anon;
    }
    out.push({ ...row, reviews: pyJson(list) });
  }
  return out;
}
