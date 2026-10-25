// Test cao chung qua GitHub voi 1 "GitHub" gia lap trong bo nho (khong goi mang).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildOutputs, parseFile } from "../lib/pipeline.js";
import { keywordId, parseRegistry, serializeRegistry } from "../lib/registry.js";
import { dataPath, TeamSync } from "../lib/teamsync.js";

/**
 * GitHub gia lap: Contents API (doc), Git Data API (tree/commit/ref).
 * Cap nhat nhanh tu commit cu -> 422 "not a fast forward" (nhu khi nguoi khac vua day len).
 */
function fakeGitHub({ empty = false } = {}) {
  const commits = new Map();
  const trees = new Map();
  let n = 0;
  const newSha = (p) => `${p}${String(++n).padStart(39, "0")}`.slice(0, 40);
  const state = { head: null, commits, log: [] };
  if (!empty) {
    const sha = newSha("c");
    commits.set(sha, { files: new Map([["README.md", "# data\n"]]), parent: null, tree: newSha("t") });
    trees.set(commits.get(sha).tree, commits.get(sha).files);
    state.head = sha;
  }
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status });
  const b64 = (text) => Buffer.from(text, "utf8").toString("base64").replace(/(.{60})/g, "$1\n"); // GitHub xuong dong 60 ky tu

  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    assert.equal(u.host, "api.github.com");
    assert.match(init.headers.Authorization, /^Bearer /);
    const p = decodeURIComponent(u.pathname);
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    await new Promise((r) => setTimeout(r, 1)); // de 2 nguoi chay xen ke

    if (p === "/user") return json({ login: "tester" });
    if (!p.startsWith("/repos/org/data")) return json({ message: "Not Found" }, 404);
    const rest = p.slice("/repos/org/data".length);
    if (rest === "") return json({ default_branch: "main" });
    if (rest === "/git/ref/heads/main") {
      return state.head ? json({ object: { sha: state.head } }) : json({ message: "Git Repository is empty." }, 409);
    }
    if (rest.startsWith("/contents/")) {
      const file = rest.slice("/contents/".length);
      const ref = u.searchParams.get("ref") || state.head;
      const files = commits.get(ref)?.files;
      return files?.has(file) ? json({ encoding: "base64", content: b64(files.get(file)) }) : json({ message: "Not Found" }, 404);
    }
    if (rest.startsWith("/git/commits/") && method === "GET") {
      const sha = rest.slice("/git/commits/".length);
      return json({ sha, tree: { sha: commits.get(sha).tree } });
    }
    if (rest === "/git/trees" && method === "POST") {
      const files = new Map(trees.get(body.base_tree));
      for (const t of body.tree) {
        assert.equal(t.mode, "100644");
        files.set(t.path, t.content);
      }
      const sha = newSha("t");
      trees.set(sha, files);
      return json({ sha }, 201);
    }
    if (rest === "/git/commits" && method === "POST") {
      const sha = newSha("c");
      commits.set(sha, { files: trees.get(body.tree), parent: body.parents[0], tree: body.tree, message: body.message });
      return json({ sha }, 201);
    }
    if (rest === "/git/refs/heads/main" && method === "PATCH") {
      assert.equal(body.force, false);
      if (commits.get(body.sha).parent !== state.head) return json({ message: "Update is not a fast forward" }, 422);
      state.head = body.sha;
      state.log.push(commits.get(body.sha).message);
      return json({ object: { sha: body.sha } });
    }
    return json({ message: `unhandled ${method} ${p}` }, 500);
  };
  const files = () => commits.get(state.head).files;
  return { state, files, fetchImpl };
}

const mk = (gh, repo = "org/data") => new TeamSync({ repo, token: "github_pat_x", fetchImpl: gh.fetchImpl, sleep: () => Promise.resolve() });

test("2 nguoi nhan keyword cung luc -> khong trung", async () => {
  const gh = fakeGitHub();
  await mk(gh).add(["a", "b", "c", "d", "e"]);
  const [r1, r2] = await Promise.all([mk(gh).claim(2), mk(gh).claim(2)]);
  const all = [...r1.picked, ...r2.picked];
  assert.equal(all.length, 4);
  assert.equal(new Set(all).size, 4, `trung keyword: ${all}`);
  const reg = parseRegistry(gh.files().get("keywords.csv"));
  assert.equal(reg.filter((r) => r.status === "in_progress").length, 4);
  assert.equal(reg.filter((r) => r.status === "todo").length, 1);
});

test("them keyword: tao keywords.csv, bo qua cai da co", async () => {
  const gh = fakeGitHub();
  const r1 = await mk(gh).add(["Tai nghe không dây", "áo thun nam"]);
  const r2 = await mk(gh).add(["  tai nghe   KHÔNG dây", "bình giữ nhiệt"]);
  assert.deepEqual(r1.added, ["tai nghe không dây", "áo thun nam"]);
  assert.deepEqual(r2.added, ["bình giữ nhiệt"]);
  assert.equal(r2.counts.total, 3);
  assert.equal(gh.files().get("README.md"), "# data\n"); // file khac khong bi dong toi
});

test("nhan keyword qua han (in_progress > 48h) duoc tra lai", async () => {
  const gh = fakeGitHub();
  const old = new Date(Date.now() - 49 * 3600_000).toISOString();
  await mk(gh).remote.commit({
    summary: "seed",
    files: [{ path: "keywords.csv", content: serializeRegistry([
      { keyword_id: keywordId("x"), keyword: "x", status: "in_progress", claimed_at: old },
      { keyword_id: keywordId("y"), keyword: "y", status: "in_progress", claimed_at: new Date().toISOString() },
    ]) }],
  });
  const r = await mk(gh).claim(5);
  assert.deepEqual(r.picked, ["x"]);
});

test("loi ro rang: repo trong / sai ten repo", async () => {
  await assert.rejects(mk(fakeGitHub({ empty: true })).claim(1), /repo đang trống/);
  await assert.rejects(mk(fakeGitHub(), "org/khong-co").claim(1), /không thấy repo/);
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const sample = path.join(root, "crawl_manually", "2026-10-21");

test("day du lieu: dung duong dan, khong BOM, nguoi mua da an danh, 1 commit",
  { skip: !fs.existsSync(sample) }, async () => {
    const names = fs.readdirSync(sample).filter((f) => f.endsWith(".html"));
    const out = buildOutputs(names.map((n) => parseFile(n, fs.readFileSync(path.join(sample, n), "utf8"))), "2026-10-21");
    const gh = fakeGitHub();
    await mk(gh).add(["tai nghe không dây"]);
    await mk(gh).claim(1);
    const r = await mk(gh).push(out, "2026-10-21");

    const id = keywordId("tai nghe không dây");
    const csv = gh.files().get(dataPath(id, "2026-10-21"));
    assert.ok(csv, `thieu file ${dataPath(id, "2026-10-21")}`);
    assert.ok(!csv.startsWith("\ufeff"), "file day len khong duoc co BOM");
    assert.ok(csv.split("\n")[0].includes("keyword_id") && csv.split("\n")[0].includes("crawled_at"));
    assert.equal(r.files, 1);
    assert.equal(r.rows, 23);

    const users = new Set();
    for (const row of out.final) for (const rv of JSON.parse(row.reviews || "[]")) if (rv.user) users.add(rv.user);
    assert.ok(users.size > 0);
    for (const u of users) assert.ok(!csv.includes(`"user"": ""${u}""`), `con ten that: ${u}`);
    assert.match(csv, /""user"": ""u_[0-9a-f]{12}""/);

    const row = parseRegistry(gh.files().get("keywords.csv")).find((x) => x.keyword_id === id);
    assert.equal(row.status, "done");
    assert.equal(row.rows, "23");
    // them keyword + nhan + (du lieu va danh sach trong CUNG 1 commit)
    assert.equal(gh.state.log.length, 3);
    assert.match(gh.state.log[2], /^Dữ liệu 2026-10-21: 1 keyword, 23 sản phẩm$/);

    if (process.env.TEAM_DUMP_DIR) { // de test team_dataset/build_dataset.py
      for (const [p, text] of gh.files()) {
        const dest = path.join(process.env.TEAM_DUMP_DIR, p);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, text);
      }
    }
  });
