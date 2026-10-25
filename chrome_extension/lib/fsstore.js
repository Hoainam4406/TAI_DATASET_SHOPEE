// Ghi file vao THU MUC DU AN (vd C:\...\TAI_DATASET_SHOPEE) bang File System Access API.
//
// Duong dan luon tuong doi goc du an, giong pipeline Python:
//   crawl_manually/<ngay>/*.html, csv_processed/*.csv, image/<ngay>/{id}_main.jpg
//
// Neu chua chon thu muc (hoac bi tu choi quyen) -> du phong: chrome.downloads vao
//   <Thu muc Downloads>/<downloadSubdir>/<duong dan tuong doi>

import * as db from "./db.js";

const HANDLE_KEY = "rootHandle";

export class Store {
  constructor() {
    this.root = null;
    this.granted = false;
    this.downloadSubdir = "SHOPEE";
  }

  async init() {
    this.root = (await db.get("kv", HANDLE_KEY)) || null;
    this.granted = this.root ? (await this.root.queryPermission({ mode: "readwrite" })) === "granted" : false;
    return this;
  }

  get mode() {
    return this.root && this.granted ? "folder" : "downloads";
  }

  get rootName() {
    return this.root?.name || "";
  }

  /** Mo hop thoai chon thu muc (can thao tac nguoi dung). */
  async pick() {
    const handle = await window.showDirectoryPicker({ id: "shopee-root", mode: "readwrite" });
    this.root = handle;
    this.granted = true;
    await db.put("kv", HANDLE_KEY, handle);
    return handle;
  }

  /** Xin lai quyen ghi (can thao tac nguoi dung, vd bam nut). */
  async ensurePermission() {
    if (!this.root) return false;
    let p = await this.root.queryPermission({ mode: "readwrite" });
    if (p !== "granted") p = await this.root.requestPermission({ mode: "readwrite" });
    this.granted = p === "granted";
    return this.granted;
  }

  async forget() {
    await db.del("kv", HANDLE_KEY);
    this.root = null;
    this.granted = false;
  }

  /** Thu muc goc co giong thu muc du an (co crawl_manually/ hoac extract_data/)? */
  async looksLikeProject() {
    if (!this.root) return false;
    for await (const [name, h] of this.root.entries()) {
      if (h.kind === "directory" && (name === "crawl_manually" || name === "extract_data")) return true;
    }
    return false;
  }

  async dir(parts, create) {
    let d = this.root;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create });
    return d;
  }

  split(relPath) {
    const parts = relPath.split("/").filter(Boolean);
    return [parts.slice(0, -1), parts[parts.length - 1]];
  }

  async write(relPath, data, type = "text/plain;charset=utf-8") {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    if (this.mode === "folder") {
      const [dirs, name] = this.split(relPath);
      const fh = await (await this.dir(dirs, true)).getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      return;
    }
    const url = URL.createObjectURL(blob);
    try {
      await new Promise((resolve, reject) => {
        chrome.downloads.download(
          { url, filename: `${this.downloadSubdir}/${relPath}`, conflictAction: "overwrite", saveAs: false },
          (id) => (chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(id)),
        );
      });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }

  async exists(relPath) {
    if (this.mode !== "folder") return false;
    try {
      const [dirs, name] = this.split(relPath);
      await (await this.dir(dirs, false)).getFileHandle(name);
      return true;
    } catch {
      return false;
    }
  }

  /** [{name, kind}] trong thu muc (rong neu khong co / che do downloads). */
  async list(relPath) {
    if (this.mode !== "folder") return [];
    try {
      const d = await this.dir(relPath.split("/").filter(Boolean), false);
      const out = [];
      for await (const [name, h] of d.entries()) out.push({ name, kind: h.kind });
      return out.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  async readText(relPath) {
    const [dirs, name] = this.split(relPath);
    const fh = await (await this.dir(dirs, false)).getFileHandle(name);
    return (await fh.getFile()).text();
  }
}
