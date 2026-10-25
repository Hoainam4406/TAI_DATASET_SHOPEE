// Client GitHub toi gian (fetch, khong can thu vien) cho 1 repo du lieu cua nhom.
//
//   whoami()             : ten tai khoan cua token
//   headSha()            : commit moi nhat cua nhanh mac dinh
//   readText(path, rev)  : doc 1 file tai 1 commit (null neu chua co)
//   commit({...})        : 1 commit NHIEU file (Git Data API: tree -> commit -> cap nhat nhanh
//                          KHONG ep). Nhanh da co commit moi hon parentCommit -> ConflictError.

export const API = "https://api.github.com";

export class RemoteError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

/** Nhanh vua co commit moi (nguoi khac day len truoc) -> doc lai va thu lai. */
export class ConflictError extends RemoteError {}

const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

function decodeBase64Utf8(b64) {
  const bin = atob(String(b64).replace(/\s+/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export class GitHubRepo {
  /**
   * token: chuoi co dinh (token tu tao), HOAC getToken: async () => token (dang nhap GitHub App,
   * tu lam moi). refresh: async () => bool — goi khi bi 401 de lam moi token roi thu lai 1 lan.
   */
  constructor({ repo, token, getToken, refresh, fetchImpl }) {
    this.repo = String(repo || "").trim()
      .replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/+$/, "");
    const fixed = String(token || "").trim();
    this.getToken = getToken || (async () => fixed);
    this.refresh = refresh || null;
    this.fetch = fetchImpl || ((...a) => fetch(...a));
    this.branchName = null;
  }

  async req(path, { method = "GET", body, accept = "application/vnd.github+json" } = {}, retried = false) {
    const res = await this.fetch(`${API}${path}`, {
      method,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${await this.getToken()}`,
        Accept: accept,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && this.refresh && !retried && (await this.refresh())) {
      return this.req(path, { method, body, accept }, true);
    }
    return res;
  }

  async fail(res, what) {
    let detail = "";
    try { detail = (await res.json()).message || ""; } catch { /* bo qua */ }
    if (res.status === 401) return new RemoteError(`${what}: token sai hoặc đã hết hạn (401).`, 401);
    if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
      return new RemoteError(`${what}: hết lượt gọi API GitHub trong giờ này, thử lại sau.`, 403);
    }
    if (res.status === 403) {
      return new RemoteError(`${what}: token không có quyền ghi (cần quyền Contents: Read and write). ${detail}`, 403);
    }
    if (res.status === 404) {
      return new RemoteError(`${what}: không thấy repo "${this.repo}" (404) — sai tên repo, hoặc token chưa được cấp quyền repo này.`, 404);
    }
    if (res.status === 409 && /empty/i.test(detail)) {
      return new RemoteError(`${what}: repo đang trống — tạo repo kèm README (tick "Add a README file").`, 409);
    }
    return new RemoteError(`${what}: HTTP ${res.status} ${detail}`, res.status);
  }

  async json(path, what, init) {
    const res = await this.req(path, init);
    if (!res.ok) throw await this.fail(res, what);
    return res.json();
  }

  async whoami() {
    return (await this.json("/user", "Kiểm tra token")).login;
  }

  async branch() {
    this.branchName ??= (await this.json(`/repos/${this.repo}`, "Đọc repo")).default_branch;
    return this.branchName;
  }

  async headSha() {
    const ref = await this.json(`/repos/${this.repo}/git/ref/heads/${encodeURIComponent(await this.branch())}`, "Đọc nhánh");
    return ref.object.sha;
  }

  async readText(path, rev) {
    const q = rev ? `?ref=${encodeURIComponent(rev)}` : "";
    const res = await this.req(`/repos/${this.repo}/contents/${encodePath(path)}${q}`);
    if (res.status === 404) return null;
    if (!res.ok) throw await this.fail(res, `Đọc ${path}`);
    const meta = await res.json();
    if (meta.encoding === "base64" && meta.content !== undefined) return decodeBase64Utf8(meta.content);
    // file > 1 MB: Contents API khong tra noi dung -> lay ban raw
    const raw = await this.req(`/repos/${this.repo}/contents/${encodePath(path)}${q}`, { accept: "application/vnd.github.raw+json" });
    if (!raw.ok) throw await this.fail(raw, `Đọc ${path}`);
    return raw.text();
  }

  /** files = [{path, content}] (van ban UTF-8). Tat ca trong 1 commit. */
  async commit({ summary, files, parentCommit }) {
    const parent = parentCommit || await this.headSha();
    const base = await this.json(`/repos/${this.repo}/git/commits/${parent}`, "Đọc commit");
    const tree = await this.json(`/repos/${this.repo}/git/trees`, "Tạo tree", {
      method: "POST",
      body: {
        base_tree: base.tree.sha,
        tree: files.map((f) => ({ path: f.path, mode: "100644", type: "blob", content: f.content })),
      },
    });
    const commit = await this.json(`/repos/${this.repo}/git/commits`, "Tạo commit", {
      method: "POST",
      body: { message: summary, tree: tree.sha, parents: [parent] },
    });
    const res = await this.req(`/repos/${this.repo}/git/refs/heads/${encodeURIComponent(await this.branch())}`, {
      method: "PATCH",
      body: { sha: commit.sha, force: false },
    });
    // 422 "Update is not a fast forward" = nguoi khac vua day len truoc
    if (res.status === 422 || res.status === 409) throw new ConflictError("Nhánh vừa có commit mới.", res.status);
    if (!res.ok) throw await this.fail(res, "Cập nhật nhánh");
    return commit.sha;
  }
}
