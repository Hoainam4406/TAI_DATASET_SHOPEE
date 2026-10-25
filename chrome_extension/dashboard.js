import { Alarm } from "./lib/alarm.js";
import { Crawler, DEFAULTS, sleep } from "./lib/crawler.js";
import { localDate, pageLimit } from "./lib/crawler-utils.js";
import * as db from "./lib/db.js";
import { Store } from "./lib/fsstore.js";
import { needsRefresh, pollDeviceFlow, refreshToken, startDeviceFlow } from "./lib/ghauth.js";
import { TeamSync } from "./lib/teamsync.js";

const $ = (id) => document.getElementById(id);
// chi lay setting co o input trong dashboard.html (thieu o -> crawler dung gia tri DEFAULTS)
const SETTING_IDS = Object.keys(DEFAULTS).filter((id) => $(id));
const STATE = {
  idle: ["neutral", "Sẵn sàng"],
  running: ["running", "Đang chạy"],
  paused: ["paused", "Tạm dừng"],
  "waiting-user": ["waiting-user", "Chờ xác minh"],
  hidden: ["paused", "Chờ cửa sổ Shopee hiện lại"],
};
const LEVEL_LABEL = { step: "BƯỚC", ok: "OK", warn: "CHÚ Ý", error: "LỖI", info: "·" };
const MAX_LOG = 800;

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

const icon = (name, cls = "ic") => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;

const store = await new Store().init();
const alarm = new Alarm(sleep);
alarm.onChange = () => render();
const crawler = new Crawler(store, { log, onChange: render, alarm });

// --- chuong bao captcha -------------------------------------------------------------
$("testAlarm").onclick = () => {
  alarm.unlock();
  alarm.beep();
};
$("muteAlarm").onclick = () => alarm.mute();
$("focusShopee").onclick = () => crawler.focusWorker();

// Tieu de tab nhap nhay khi dang cho captcha (thay duoc ca khi Dashboard nam phia sau)
const BASE_TITLE = document.title;
(async () => {
  let flip = false;
  for (;;) {
    await sleep(1000);
    flip = crawler.state === "waiting-user" ? !flip : false;
    document.title = flip ? "(!) CẦN GIẢI CAPTCHA" : BASE_TITLE;
  }
})();

// --- nhat ky -------------------------------------------------------------------
let logTotal = 0;
function log(msg, level = "info") {
  const el = $("log");
  const stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
  const row = document.createElement("div");
  row.className = `log-row new lv-${level}`;
  const t = new Date().toLocaleTimeString("vi-VN", { hour12: false });
  row.innerHTML = `<span class="log-time">${t}</span><span class="log-lv">${LEVEL_LABEL[level] || "·"}</span>`
    + `<span class="log-msg">${esc(msg)}</span>`;
  el.append(row);
  while (el.childElementCount > MAX_LOG) el.firstElementChild.remove();
  logTotal += 1;
  $("logCount").textContent = `${logTotal} dòng`;
  if (stick) el.scrollTop = el.scrollHeight;
}
$("clearLog").onclick = () => {
  $("log").replaceChildren();
  logTotal = 0;
  $("logCount").textContent = "";
};

// --- cai dat (luu lai giua cac lan mo) ------------------------------------------
function readSettings() {
  const s = {};
  for (const id of SETTING_IDS) {
    const el = $(id);
    s[id] = el.type === "checkbox" ? el.checked : Number(el.value);
  }
  if (s.delayMax < s.delayMin) s.delayMax = s.delayMin;
  if (s.breakMax < s.breakMin) s.breakMax = s.breakMin;
  return s;
}

function writeSettings(s) {
  for (const id of SETTING_IDS) {
    const el = $(id);
    if (el.type === "checkbox") el.checked = !!s[id];
    else el.value = s[id];
  }
}

async function persistForm() {
  await db.put("kv", "form", { settings: readSettings(), keywords: $("keywords").value });
}

/** O "Tat ca" bat -> khoa o so tuong ung + canh bao thoi gian chay. */
function syncFull() {
  $("pages").disabled = $("pagesAll").checked;
  $("maxProducts").disabled = $("productsAll").checked;
  const hint = $("fullHint");
  if ($("productsAll").checked && $("fetchPdp").checked) {
    hint.hidden = false;
    hint.textContent = $("pagesAll").checked
      ? "Mở mọi sản phẩm của mọi trang: khoảng 60 SP × tối đa 17 trang cho mỗi keyword, có thể mất nhiều giờ."
      : "Mở mọi sản phẩm tìm thấy: khoảng 60 trang sản phẩm cho mỗi trang kết quả.";
  } else {
    hint.hidden = true;
  }
}
for (const id of ["pagesAll", "productsAll", "fetchPdp"]) $(id).addEventListener("change", syncFull);

const form = (await db.get("kv", "form")) || {};
writeSettings({ ...DEFAULTS, ...(form.settings || {}) });
$("keywords").value = form.keywords || "";
for (const id of [...SETTING_IDS, "keywords"]) $(id).addEventListener("change", persistForm);
syncFull();

// --- thu muc du an ----------------------------------------------------------------
function callout(kind, iconName, html) {
  const st = $("folderStatus");
  st.className = `callout ${kind}`;
  st.innerHTML = `${icon(iconName)}<div>${html}</div>`;
}

async function renderFolder() {
  $("grantFolder").hidden = !store.root || store.granted;
  $("forgetFolder").hidden = !store.root;
  $("pickFolder").lastChild.textContent = store.root ? "Đổi thư mục" : "Chọn thư mục";
  const name = `<span class="path">${esc(store.rootName)}</span>`;
  if (!store.root) {
    callout("warn", "warn", "<strong>Chưa chọn thư mục.</strong> Hãy chọn thư mục gốc <span class=\"path\">TAI_DATASET_SHOPEE</span>; "
      + "nếu không, file sẽ được tải vào <span class=\"path\">Downloads/SHOPEE</span>.");
  } else if (!store.granted) {
    callout("warn", "warn", `<strong>Cần cấp lại quyền ghi</strong> cho ${name}. Chrome hỏi lại sau mỗi lần khởi động.`);
  } else if (await store.looksLikeProject()) {
    callout("ok", "check", `<strong>Đang ghi vào ${name}</strong><br>crawl_manually/ · csv_processed/ · image/`);
  } else {
    callout("warn", "warn", `Đang ghi vào ${name}, nhưng bên trong không có <span class="path">crawl_manually/</span>. `
      + "Extension sẽ tự tạo các thư mục cần thiết.");
  }
  await renderDates();
}

$("pickFolder").onclick = async () => {
  try {
    await store.pick();
    log(`Đã chọn thư mục "${store.rootName}".`, "ok");
  } catch (e) {
    if (e.name !== "AbortError") log(`Không chọn được thư mục: ${e.message}`, "error");
  }
  renderFolder();
};
$("grantFolder").onclick = async () => {
  await store.ensurePermission();
  renderFolder();
};
$("forgetFolder").onclick = async () => {
  await store.forget();
  renderFolder();
};

/** Xin quyen ghi thu muc trong luc con "user gesture". false = nguoi dung huy. */
async function readyToWrite() {
  if (store.root && !store.granted) await store.ensurePermission();
  if (store.mode === "folder") return true;
  return confirm("Chưa có quyền ghi vào thư mục dự án.\nLưu file vào Downloads/SHOPEE thay thế?");
}

// --- danh sach ngay de xu ly ------------------------------------------------------
async function renderDates() {
  const dates = new Set();
  for (const d of await store.list("crawl_manually")) {
    if (d.kind === "directory" && /^\d{4}-\d{2}-\d{2}$/.test(d.name)) dates.add(d.name);
  }
  for (const k of await db.keysByPrefix("parsed", "")) dates.add(k.slice(0, 10));
  const list = [...dates].sort().reverse();
  for (const sel of [$("processDate"), $("teamDate")]) {
    const prev = sel.value;
    sel.replaceChildren();
    if (!list.length) sel.add(new Option("Chưa có dữ liệu", ""));
    for (const d of list) sel.add(new Option(d, d));
    if (list.includes(prev)) sel.value = prev;
  }
}

// --- dieu khien job ---------------------------------------------------------------
$("start").onclick = async () => {
  alarm.unlock(); // cu bam nay cho phep Chrome phat chuong ve sau
  const keywords = $("keywords").value.split("\n").map((s) => s.trim()).filter(Boolean);
  if (!keywords.length) {
    $("keywords").focus();
    log("Nhập ít nhất 1 keyword.", "warn");
    return;
  }
  const job = crawler.job;
  if (job && job.status !== "done" && !confirm("Có job chưa xong. Bỏ job đó và bắt đầu job mới?")) return;
  if (!(await readyToWrite())) return;
  await persistForm();
  crawler.newJob(keywords, readSettings());
  await crawler.save();
  renderFolder();
  crawler.run();
};

$("resumeJob").onclick = async () => {
  alarm.unlock();
  if (!(await readyToWrite())) return;
  if (crawler.job.date !== localDate()) {
    log(`Job thuộc ngày ${crawler.job.date}, file vẫn lưu vào thư mục ngày đó.`, "info");
  }
  crawler.run();
};

$("pause").onclick = () => (crawler.state === "paused" ? crawler.resume() : crawler.pause());
$("stop").onclick = () => crawler.stop();

$("process").onclick = async () => {
  const date = $("processDate").value;
  if (!date) return;
  if (!(await readyToWrite())) return;
  $("process").disabled = true;
  try {
    await crawler.process(date, { images: $("processImages").checked, force: true });
  } catch (e) {
    log(`Lỗi xử lý: ${e.message}`, "error");
  } finally {
    $("process").disabled = false;
    render();
  }
};

// --- Cao chung voi nhom (repo GitHub) ----------------------------------------------
// Dang nhap: GitHub App (device flow, tu lam moi token) hoac token tu tao (du phong).
// Repo + thong tin dang nhap chi luu trong IndexedDB cua extension tren may nay.
// team.config.json (nguoi quan ly dien san) -> gia tri mac dinh cho repo + Client ID.
let teamDefaults = {};
try {
  teamDefaults = await (await fetch(chrome.runtime.getURL("team.config.json"))).json();
} catch { /* khong co file cau hinh */ }

const teamConf = (await db.get("kv", "team")) || {};
if (teamConf.token && !teamConf.auth) teamConf.auth = { type: "pat", token: teamConf.token }; // ban cu
delete teamConf.token;
$("teamRepo").value = teamConf.repo || teamDefaults.repo || "";
$("teamClientId").value = teamConf.clientId || teamDefaults.githubAppClientId || "";
$("teamToken").value = teamConf.auth?.type === "pat" ? teamConf.auth.token : "";
$("teamAuto").checked = !!teamConf.autoPush;

async function saveTeam() {
  teamConf.repo = $("teamRepo").value.trim();
  teamConf.clientId = $("teamClientId").value.trim();
  teamConf.autoPush = $("teamAuto").checked;
  await db.put("kv", "team", teamConf);
}
for (const id of ["teamRepo", "teamClientId", "teamAuto"]) $(id).addEventListener("change", saveTeam);

function teamShow(kind, iconName, html) {
  const el = $("teamStatus");
  el.hidden = false;
  el.className = `callout ${kind}`;
  el.innerHTML = `${icon(iconName)}<div>${html}</div>`;
}
const countsText = (c) => `Danh sách chung: ${c.todo} chưa làm · ${c.in_progress} đang cào · ${c.done} xong`;

function renderTeamAuth() {
  const a = teamConf.auth;
  $("teamLoggedOut").hidden = !!a;
  $("teamLoggedIn").hidden = !a;
  if (a) {
    const how = a.type === "app" ? "đăng nhập GitHub" : "token";
    $("teamUser").innerHTML = `Đã kết nối: <strong>${esc(a.login || "?")}</strong> <span class="muted">(${how})</span>`;
  }
}

// Lam moi token GitHub App (song 8 gio) bang refresh token (song 6 thang) — 1 lan 1 luc.
let refreshing = null;
async function refreshAuth() {
  const a = teamConf.auth;
  if (a?.type !== "app" || !a.refresh_token) return false;
  refreshing ??= (async () => {
    try {
      const t = await refreshToken({ clientId: teamConf.clientId || $("teamClientId").value.trim(), refreshToken: a.refresh_token });
      teamConf.auth = { ...a, ...t };
      await saveTeam();
      return true;
    } catch (e) {
      log(`${e.message}`, "error");
      return false;
    } finally {
      setTimeout(() => { refreshing = null; }, 0);
    }
  })();
  return refreshing;
}

async function currentToken() {
  if (needsRefresh(teamConf.auth)) await refreshAuth();
  return teamConf.auth?.token || "";
}

function makeSync() {
  const repo = $("teamRepo").value.trim();
  if (!teamConf.auth) {
    teamShow("warn", "warn", "Chưa đăng nhập — bấm <strong>Đăng nhập bằng GitHub</strong>.");
    return null;
  }
  if (!repo) {
    teamShow("warn", "warn", "Nhập tên repo GitHub của nhóm (vd <span class=\"path\">ten-org/shopee-data</span>).");
    return null;
  }
  return new TeamSync({ repo, getToken: currentToken, refresh: refreshAuth, log, sleep });
}

/** Giai thich them cho loi thuong gap khi dang nhap bang GitHub App. */
function explain(e) {
  let msg = esc(e.message);
  if (teamConf.auth?.type === "app" && (e.status === 404 || e.status === 403)) {
    msg += "<br>Với đăng nhập GitHub: GitHub App phải được <strong>cài vào repo này</strong> (người quản lý vào "
      + "Install App) và bạn phải có quyền <strong>Write</strong> trong repo.";
  }
  if (e.status === 401) msg += "<br>Bấm <strong>Đăng xuất</strong> rồi đăng nhập lại.";
  return msg;
}

async function teamRun(btn, fn) {
  const sync = makeSync();
  if (!sync) return;
  btn.disabled = true;
  try {
    await fn(sync);
  } catch (e) {
    teamShow("warn", "warn", explain(e));
    log(`GitHub: ${e.message}`, "error");
  } finally {
    btn.disabled = false;
  }
}

async function showRepoStatus(sync) {
  await saveTeam();
  const st = await sync.status();
  if (teamConf.auth && teamConf.auth.login !== st.user) {
    teamConf.auth.login = st.user;
    await saveTeam();
    renderTeamAuth();
  }
  teamShow("ok", "check", `<strong>Kết nối được repo</strong> <span class="path">${esc(sync.repo)}</span><br>${countsText(st.counts)}`);
}

// --- Dang nhap bang GitHub (device flow) ---
let device = null;
let loginCancelled = false;

async function copyCode() {
  try {
    await navigator.clipboard.writeText(device?.user_code || "");
    $("teamDeviceHint").textContent = "Đã chép mã. Đang chờ bạn bấm Authorize trên GitHub…";
  } catch { /* trinh duyet khong cho chep: nguoi dung tu chep */ }
}

$("teamLogin").onclick = async () => {
  await saveTeam();
  const clientId = $("teamClientId").value.trim();
  $("teamLogin").disabled = true;
  try {
    device = await startDeviceFlow(clientId);
  } catch (e) {
    teamShow("warn", "warn", esc(e.message));
    $("teamLogin").disabled = false;
    return;
  }
  loginCancelled = false;
  $("teamStatus").hidden = true;
  $("teamCode").textContent = device.user_code;
  $("teamDevice").hidden = false;
  $("teamDeviceHint").textContent = "Đang chờ bạn bấm Authorize trên GitHub…";
  copyCode();
  try {
    const t = await pollDeviceFlow({ clientId, device, sleep, isCancelled: () => loginCancelled });
    teamConf.auth = { type: "app", ...t };
    const sync = makeSync();
    teamConf.auth.login = sync ? await sync.remote.whoami() : "";
    await saveTeam();
    $("teamDevice").hidden = true;
    renderTeamAuth();
    log(`Đã đăng nhập GitHub: ${teamConf.auth.login}`, "ok");
    if (sync) await showRepoStatus(sync);
  } catch (e) {
    $("teamDevice").hidden = true;
    if (e.code !== "cancelled") teamShow("warn", "warn", explain(e));
  } finally {
    $("teamLogin").disabled = false;
  }
};

$("teamOpenGithub").onclick = () => chrome.tabs.create({ url: device?.verification_uri || "https://github.com/login/device" });
$("teamCopy").onclick = copyCode;
$("teamCancel").onclick = () => {
  loginCancelled = true;
  $("teamDevice").hidden = true;
};

$("teamLogout").onclick = async () => {
  teamConf.auth = null;
  $("teamToken").value = "";
  await saveTeam();
  renderTeamAuth();
  teamShow("ok", "check", "Đã đăng xuất khỏi GitHub trên extension này.");
};

$("teamCheck").onclick = () => teamRun($("teamCheck"), showRepoStatus);

async function pushDay(sync, out, date) {
  log(`Đẩy dữ liệu ngày ${date} lên GitHub (${sync.repo})...`, "step");
  const r = await sync.push(out, date);
  if (!r.files) {
    log("Không có sản phẩm nào gắn keyword để đẩy (chỉ sản phẩm thấy trên trang tìm kiếm mới có keyword).", "warn");
    return r;
  }
  log(`Đã đẩy ${r.files} keyword, ${r.rows} sản phẩm → data/<keyword>/${date}.csv`, "ok");
  teamShow("ok", "check", `<strong>Đã đẩy ${r.files} keyword (${r.rows} sản phẩm).</strong><br>${countsText(r.counts)}`);
  return r;
}

// --- Du phong: token tu tao ---
$("teamConnect").onclick = async () => {
  const token = $("teamToken").value.trim();
  if (!token) {
    teamShow("warn", "warn", "Dán token vào ô trước.");
    return;
  }
  const prev = teamConf.auth;
  teamConf.auth = { type: "pat", token };
  const sync = makeSync();
  if (!sync) return;
  try {
    await showRepoStatus(sync);
    log(`Đã kết nối GitHub bằng token: ${teamConf.auth.login}`, "ok");
  } catch (e) {
    teamConf.auth = prev; // token loi -> giu cach dang nhap cu
    await saveTeam();
    renderTeamAuth();
    teamShow("warn", "warn", explain(e));
  }
};

$("teamClaim").onclick = () => teamRun($("teamClaim"), async (sync) => {
  if ($("keywords").value.trim() && !confirm("Thay nội dung ô Keyword bằng các keyword sắp nhận?")) return;
  const n = Math.max(1, Math.min(100, Number($("teamClaimN").value) || 5));
  const r = await sync.claim(n);
  if (!r.picked.length) {
    teamShow("warn", "warn", `Không còn keyword nào trống.<br>${countsText(r.counts)}`);
    return;
  }
  $("keywords").value = r.picked.join("\n");
  await persistForm();
  log(`Đã nhận ${r.picked.length} keyword: ${r.picked.join(", ")}`, "ok");
  teamShow("ok", "check", `<strong>Đã nhận ${r.picked.length} keyword</strong> và điền vào ô 02 — bấm Bắt đầu cào.<br>${countsText(r.counts)}`);
});

$("teamAdd").onclick = () => teamRun($("teamAdd"), async (sync) => {
  const list = $("keywords").value.split("\n").map((x) => x.trim()).filter(Boolean);
  if (!list.length) {
    teamShow("warn", "warn", "Ô Keyword (02) đang trống.");
    return;
  }
  const r = await sync.add(list);
  log(`Thêm ${r.added.length}/${list.length} keyword vào danh sách chung (còn lại đã có sẵn).`, "ok");
  teamShow("ok", "check", `<strong>Đã thêm ${r.added.length} keyword mới</strong> (${list.length - r.added.length} cái đã có).<br>${countsText(r.counts)}`);
});

$("teamPush").onclick = () => teamRun($("teamPush"), async (sync) => {
  const date = $("teamDate").value;
  if (!date) return;
  if (crawler.state !== "idle") {
    teamShow("warn", "warn", "Đang cào — đợi job xong (hoặc bật \"Tự đẩy lên khi cào xong\").");
    return;
  }
  if (!(await readyToWrite())) return;
  const out = await crawler.process(date, { images: false });
  if (out) await pushDay(sync, out, date);
});

// cao xong -> tu day len (neu bat)
crawler.afterProcess = async (out, date) => {
  if (!$("teamAuto").checked) return;
  const sync = makeSync();
  if (sync) await pushDay(sync, out, date);
};

window.addEventListener("beforeunload", (e) => {
  if (crawler.state !== "idle") e.preventDefault();
});

// --- hien thi ------------------------------------------------------------------
function statusTag(kw, active) {
  if (kw.phase === "done") return `<span class="tag done">Xong</span>`;
  if (active) return `<span class="tag active">${kw.phase === "listing" ? "Đang tìm" : "Đang mở SP"}</span>`;
  return `<span class="tag wait">Chờ</span>`;
}

function render() {
  const state = crawler.state;
  const job = crawler.job;
  const running = state !== "idle";

  const [cls, label] = STATE[state];
  $("state").className = `badge ${cls}`;
  $("stateText").textContent = label;
  $("blockedBanner").hidden = state !== "waiting-user";
  $("muteAlarm").hidden = !alarm.ringing || alarm.muted;

  $("start").hidden = running;
  $("resumeJob").hidden = running || !job || job.status === "done";
  $("pause").hidden = !running;
  $("pause").querySelector("use").setAttribute("href", state === "paused" ? "#i-play" : "#i-pause");
  $("pause").querySelector("svg").classList.toggle("fill", state === "paused");
  $("pause").querySelector("span").textContent = state === "paused" ? "Tiếp tục" : "Tạm dừng";
  $("stop").hidden = !running;
  $("process").disabled = running;

  const s = job?.stats || {};
  $("sListing").textContent = s.listingPages ?? 0;
  $("sPdp").textContent = s.pdps ?? 0;
  $("sSkipped").textContent = s.skipped ?? 0;
  $("sFailed").textContent = s.failed ?? 0;
  $("sBlocked").textContent = `${s.blocked ?? 0} / ${s.hidden ?? 0}`;

  $("emptyProgress").hidden = !!job;
  $("jobDate").hidden = !job;
  if (!job) {
    $("progress").replaceChildren();
    return;
  }
  $("jobDate").textContent = job.date;

  const activeIdx = running ? job.keywords.findIndex((k) => k.phase !== "done") : -1;
  $("progress").innerHTML = job.keywords.map((kw, i) => {
    const limit = pageLimit(job.settings, kw.totalPages);
    const pagesDone = Math.min(kw.nextPage - 1, limit);
    // "Tat ca" ma chua biet tong trang: hien "?" (hoac so trang da xong khi keyword da xong)
    const pagesTotal = job.settings.pagesAll && !kw.totalPages ? (kw.phase === "listing" ? "?" : pagesDone) : limit;
    const finished = kw.queue.filter((it) => it.status !== "pending").length;
    const total = kw.queue.length;
    const pct = total ? Math.round((finished / total) * 100) : 0;
    const pdp = job.settings.fetchPdp
      ? `<div class="prog"><div class="bar"><span style="width:${pct}%"></span></div><span class="num">${finished}/${total}</span></div>`
      : `<span class="muted">Tắt</span>`;
    return `<tr><td class="kw">${esc(kw.keyword)}</td><td class="num">${pagesDone}/${pagesTotal}</td>`
      + `<td class="num">${kw.found}</td><td>${pdp}</td><td>${statusTag(kw, i === activeIdx)}</td></tr>`;
  }).join("");
}

renderTeamAuth();
await crawler.loadJob();
if (crawler.job && crawler.job.status === "running") crawler.job.status = "stopped"; // dashboard da bi dong giua chung
await renderFolder();
render();
log("Sẵn sàng. Đăng nhập shopee.vn trước khi bắt đầu để ít bị yêu cầu xác minh.", "info");
