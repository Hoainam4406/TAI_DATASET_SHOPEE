// Cao chung voi nhom qua 1 repo GitHub: nhan keyword / them keyword / day du lieu.
//
// Moi thay doi keywords.csv deu dua tren commit vua doc; neu nguoi khac day len truoc
// (nhanh da doi) -> doc lai danh sach moi nhat, lam lai, thu toi da 5 lan.
// Nho vay 2 nguoi bam "Nhan keyword" cung luc khong bao gio nhan trung keyword.

import { ConflictError, GitHubRepo } from "./github.js";
import { toCsv } from "./parser.js";
import { KEYWORD_COLUMNS, keywordGroups } from "./pipeline.js";
import {
  REGISTRY_PATH, addKeywords, anonymizeReviews, claimKeywords, markDone,
  parseRegistry, registryCounts, serializeRegistry,
} from "./registry.js";

const MAX_TRIES = 5;

/** Duong dan du lieu cua 1 keyword trong 1 ngay. */
export const dataPath = (id, date) => `data/${id}/${date}.csv`;

export class TeamSync {
  constructor({ repo, token, getToken, refresh, log = () => {}, sleep, fetchImpl }) {
    this.remote = new GitHubRepo({ repo, token, getToken, refresh, fetchImpl });
    this.log = log;
    this.sleep = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get repo() {
    return this.remote.repo;
  }

  /**
   * Doc keywords.csv tai commit moi nhat -> mutate(reg) -> commit (kem extraFiles).
   * mutate tra ve {changed, ...}; changed=false va khong co extraFiles -> khong commit.
   */
  async withRegistry(summary, mutate, extraFiles = []) {
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      const sha = await this.remote.headSha();
      const reg = parseRegistry((await this.remote.readText(REGISTRY_PATH, sha)) ?? "");
      const result = mutate(reg);
      if (!result.changed && !extraFiles.length) return { ...result, counts: registryCounts(reg) };
      try {
        await this.remote.commit({
          summary,
          parentCommit: sha,
          files: [...extraFiles, { path: REGISTRY_PATH, content: serializeRegistry(reg) }],
        });
        return { ...result, counts: registryCounts(reg) };
      } catch (e) {
        if (!(e instanceof ConflictError) || attempt === MAX_TRIES) throw e;
        this.log(`Repo vừa có người cập nhật — đọc lại danh sách và thử lại (${attempt}/${MAX_TRIES - 1}).`, "info");
        await this.sleep(800 + Math.random() * 1500 * attempt);
      }
    }
    throw new Error("Không cập nhật được danh sách keyword.");
  }

  async status() {
    const user = await this.remote.whoami();
    const reg = parseRegistry((await this.remote.readText(REGISTRY_PATH)) ?? "");
    return { user, counts: registryCounts(reg) };
  }

  /** Nhan toi da n keyword chua ai lam. */
  async claim(n) {
    return this.withRegistry(`Nhận ${n} keyword`, (reg) => {
      const picked = claimKeywords(reg, n);
      return { changed: picked.length > 0, picked: picked.map((p) => p.keyword) };
    });
  }

  /** Them keyword vao danh sach chung (bo qua cai da co). Tao keywords.csv neu chua co. */
  async add(keywords, group = "") {
    return this.withRegistry("Thêm keyword", (reg) => {
      const added = addKeywords(reg, keywords, group);
      return { changed: added.length > 0, added: added.map((a) => a.keyword) };
    });
  }

  /**
   * Day du lieu 1 ngay: tach file final theo keyword -> data/<keyword_id>/<ngay>.csv
   * (nguoi mua da an danh), va danh dau cac keyword do la "done" — tat ca trong 1 commit.
   */
  async push(out, date) {
    const groups = keywordGroups(out); // giong het csv_processed/keywords/<keyword_id>/ tren may
    if (!groups.size) return { files: 0, rows: 0, keywords: [] };

    const crawledAt = new Date().toISOString();
    const files = [];
    const done = {};
    for (const [id, g] of groups) {
      const rows = g.rows.map((r) => ({ ...r, crawled_at: crawledAt }));
      const anon = await anonymizeReviews(rows);
      files.push({ path: dataPath(id, date), content: toCsv(anon, [...KEYWORD_COLUMNS, "crawled_at"], { bom: false }) });
      done[id] = { keyword: g.keyword, rows: rows.length };
    }
    const total = Object.values(done).reduce((a, d) => a + d.rows, 0);
    const r = await this.withRegistry(
      `Dữ liệu ${date}: ${files.length} keyword, ${total} sản phẩm`,
      (reg) => {
        markDone(reg, done);
        return { changed: true };
      },
      files,
    );
    return { files: files.length, rows: total, keywords: Object.values(done).map((d) => d.keyword), counts: r.counts };
  }
}
