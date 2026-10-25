// Test dang nhap GitHub (device flow) + tu lam moi token, voi GitHub gia lap.
import assert from "node:assert/strict";
import test from "node:test";

import { needsRefresh, pollDeviceFlow, refreshToken, startDeviceFlow } from "../lib/ghauth.js";
import { GitHubRepo } from "../lib/github.js";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status });

/** GitHub login gia lap: nguoi dung "bam Authorize" sau `pendingPolls` lan hoi. */
function fakeLogin({ pendingPolls = 2, slowDownAt = -1, deny = false, disabled = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    assert.equal(init.method, "POST");
    assert.equal(init.headers.Accept, "application/json");
    calls.push(u.pathname + u.search);
    if (u.pathname === "/login/device/code") {
      if (u.searchParams.get("client_id") !== "Iv23good") return json({ error: "incorrect_client_credentials" });
      if (disabled) return json({ error: "device_flow_disabled" });
      return json({ device_code: "d".repeat(40), user_code: "WDJB-MJHT", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 });
    }
    if (u.pathname === "/login/oauth/access_token") {
      const grant = u.searchParams.get("grant_type");
      if (grant === "refresh_token") {
        assert.equal(u.searchParams.get("client_secret"), null, "khong duoc gui client secret");
        return u.searchParams.get("refresh_token") === "ghr_ok"
          ? json({ access_token: "ghu_new", expires_in: 28800, refresh_token: "ghr_ok2", refresh_token_expires_in: 15897600 })
          : json({ error: "bad_refresh_token" });
      }
      assert.equal(grant, "urn:ietf:params:oauth:grant-type:device_code");
      const n = calls.filter((c) => c.startsWith("/login/oauth/access_token")).length;
      if (deny) return json({ error: "access_denied" });
      if (n === slowDownAt) return json({ error: "slow_down", interval: 10 });
      if (n <= pendingPolls) return json({ error: "authorization_pending" });
      return json({ access_token: "ghu_tok", expires_in: 28800, refresh_token: "ghr_ok", refresh_token_expires_in: 15897600 });
    }
    return json({}, 404);
  };
  return { calls, fetchImpl };
}

test("device flow: cho -> slow_down (tang interval) -> nhan token", async () => {
  const gh = fakeLogin({ pendingPolls: 3, slowDownAt: 2 });
  const device = await startDeviceFlow("Iv23good", { fetchImpl: gh.fetchImpl });
  assert.equal(device.user_code, "WDJB-MJHT");
  const waits = [];
  const t = await pollDeviceFlow({ clientId: "Iv23good", device, fetchImpl: gh.fetchImpl, sleep: async (ms) => { waits.push(ms); } });
  assert.equal(t.token, "ghu_tok");
  assert.equal(t.refresh_token, "ghr_ok");
  assert.ok(t.expires_at > Date.now() + 7 * 3600_000);
  assert.deepEqual(waits, [5000, 5000, 10000, 10000]); // sau slow_down: 10 giay
});

test("device flow: loi ro rang (sai Client ID / chua bat Device Flow / bam Cancel / huy)", async () => {
  await assert.rejects(startDeviceFlow("Iv23bad", { fetchImpl: fakeLogin().fetchImpl }), /Client ID/);
  await assert.rejects(startDeviceFlow("Iv23good", { fetchImpl: fakeLogin({ disabled: true }).fetchImpl }), /Enable Device Flow/);
  await assert.rejects(startDeviceFlow("", { fetchImpl: fakeLogin().fetchImpl }), /Thiếu Client ID/);
  const deny = fakeLogin({ deny: true });
  const device = await startDeviceFlow("Iv23good", { fetchImpl: deny.fetchImpl });
  await assert.rejects(pollDeviceFlow({ clientId: "Iv23good", device, fetchImpl: deny.fetchImpl, sleep: async () => {} }), /Cancel/);
  const gh = fakeLogin({ pendingPolls: 99 });
  let polls = 0;
  await assert.rejects(pollDeviceFlow({
    clientId: "Iv23good", device, fetchImpl: gh.fetchImpl, sleep: async () => {}, isCancelled: () => ++polls > 2,
  }), (e) => e.code === "cancelled");
  // het 15 phut
  await assert.rejects(pollDeviceFlow({
    clientId: "Iv23good", device: { ...device, expires_at: 0 }, fetchImpl: gh.fetchImpl, sleep: async () => {},
  }), /hết hạn/);
});

test("lam moi token: khong can client secret; refresh token hong -> bao dang nhap lai", async () => {
  const gh = fakeLogin();
  const t = await refreshToken({ clientId: "Iv23good", refreshToken: "ghr_ok", fetchImpl: gh.fetchImpl });
  assert.equal(t.token, "ghu_new");
  await assert.rejects(refreshToken({ clientId: "Iv23good", refreshToken: "ghr_old", fetchImpl: gh.fetchImpl }), /đăng nhập/i);
  assert.ok(needsRefresh({ type: "app", expires_at: Date.now() + 60_000 }));
  assert.ok(!needsRefresh({ type: "app", expires_at: Date.now() + 3600_000 }));
  assert.ok(!needsRefresh({ type: "pat", token: "x" }));
});

test("GitHubRepo: bi 401 -> lam moi token 1 lan roi goi lai", async () => {
  let token = "ghu_expired";
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(init.headers.Authorization);
    return init.headers.Authorization === "Bearer ghu_fresh" ? json({ login: "tester" }) : json({ message: "Bad credentials" }, 401);
  };
  const repo = new GitHubRepo({
    repo: "org/data", fetchImpl, getToken: async () => token,
    refresh: async () => { token = "ghu_fresh"; return true; },
  });
  assert.equal(await repo.whoami(), "tester");
  assert.deepEqual(seen, ["Bearer ghu_expired", "Bearer ghu_fresh"]);

  // lam moi that bai -> bao loi 401, khong lap vo han
  const repo2 = new GitHubRepo({ repo: "org/data", fetchImpl, getToken: async () => "ghu_dead", refresh: async () => false });
  await assert.rejects(repo2.whoami(), /401/);
});
