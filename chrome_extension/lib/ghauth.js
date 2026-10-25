// "Dang nhap bang GitHub" qua device flow cua 1 GitHub App (khong can client secret).
//
//   1. startDeviceFlow(clientId)  -> ma 8 ky tu (vd WDJB-MJHT) + trang github.com/login/device
//   2. nguoi dung mo trang, nhap ma, bam Authorize
//   3. pollDeviceFlow(...)        -> token (ghu_...) + refresh token (ghr_..., song 6 thang)
//   4. refreshToken(...)          -> token moi khi token cu (8 gio) sap het han
//
// Token cua GitHub App chi dung duoc trong cac repo da cai app VA nguoi do co quyen ghi.

export const LOGIN = "https://github.com/login";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export class AuthError extends Error {
  constructor(message, code = "") {
    super(message);
    this.code = code;
  }
}

const MESSAGES = {
  expired_token: "Mã đã hết hạn (15 phút) — bấm Đăng nhập bằng GitHub lại.",
  token_expired: "Mã đã hết hạn (15 phút) — bấm Đăng nhập bằng GitHub lại.",
  access_denied: "Bạn đã bấm Cancel trên GitHub — đăng nhập bị huỷ.",
  device_flow_disabled: "GitHub App chưa bật Device Flow — người quản lý cần tick \"Enable Device Flow\" trong cài đặt app.",
  incorrect_client_credentials: "Client ID của GitHub App không đúng (lưu ý: Client ID khác App ID).",
  incorrect_device_code: "Mã đăng nhập không hợp lệ — bấm Đăng nhập bằng GitHub lại.",
  bad_verification_code: "Mã đăng nhập không hợp lệ — bấm Đăng nhập bằng GitHub lại.",
  unsupported_grant_type: "Lỗi đăng nhập (grant_type) — báo cho người làm extension.",
  bad_refresh_token: "Phiên đăng nhập GitHub đã hết hạn — bấm Đăng nhập bằng GitHub lại.",
};

async function post(fetchImpl, path, params) {
  const res = await fetchImpl(`${LOGIN}${path}?${new URLSearchParams(params)}`, {
    method: "POST",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  let body = {};
  try { body = await res.json(); } catch { /* bo qua */ }
  if (!res.ok && !body.error) throw new AuthError(`Đăng nhập GitHub lỗi HTTP ${res.status}.`, String(res.status));
  return body;
}

/** Chuyen phan hoi token cua GitHub -> {token, refresh_token, expires_at, refresh_expires_at}. */
function tokenSet(body, now) {
  return {
    token: body.access_token,
    refresh_token: body.refresh_token || "",
    expires_at: body.expires_in ? now + body.expires_in * 1000 : 0, // 0 = khong het han
    refresh_expires_at: body.refresh_token_expires_in ? now + body.refresh_token_expires_in * 1000 : 0,
  };
}

export async function startDeviceFlow(clientId, { fetchImpl = (...a) => fetch(...a) } = {}) {
  if (!clientId) throw new AuthError("Thiếu Client ID của GitHub App — hỏi người quản lý nhóm.", "no_client_id");
  const body = await post(fetchImpl, "/device/code", { client_id: clientId });
  if (body.error) throw new AuthError(MESSAGES[body.error] || `Đăng nhập GitHub lỗi: ${body.error_description || body.error}`, body.error);
  return {
    device_code: body.device_code,
    user_code: body.user_code,
    verification_uri: body.verification_uri || `${LOGIN}/device`,
    expires_at: Date.now() + (body.expires_in || 900) * 1000,
    interval: body.interval || 5,
  };
}

/**
 * Hoi GitHub moi `interval` giay cho toi khi nguoi dung bam Authorize.
 * isCancelled() -> true thi dung (nem AuthError "cancelled").
 */
export async function pollDeviceFlow({ clientId, device, sleep, isCancelled = () => false, fetchImpl = (...a) => fetch(...a), now = () => Date.now() }) {
  let interval = device.interval;
  for (;;) {
    await sleep(interval * 1000);
    if (isCancelled()) throw new AuthError("Đã huỷ đăng nhập.", "cancelled");
    if (now() > device.expires_at) throw new AuthError(MESSAGES.expired_token, "expired_token");
    const body = await post(fetchImpl, "/oauth/access_token", {
      client_id: clientId, device_code: device.device_code, grant_type: DEVICE_GRANT,
    });
    if (body.access_token) return tokenSet(body, now());
    if (body.error === "authorization_pending") continue;
    if (body.error === "slow_down") {
      interval = body.interval || interval + 5;
      continue;
    }
    throw new AuthError(MESSAGES[body.error] || `Đăng nhập GitHub lỗi: ${body.error_description || body.error}`, body.error);
  }
}

/** Lam moi token (device flow -> khong can client secret). */
export async function refreshToken({ clientId, refreshToken: rt, fetchImpl = (...a) => fetch(...a), now = Date.now() }) {
  const body = await post(fetchImpl, "/oauth/access_token", { client_id: clientId, grant_type: "refresh_token", refresh_token: rt });
  if (!body.access_token) {
    throw new AuthError(MESSAGES[body.error] || MESSAGES.bad_refresh_token, body.error || "refresh_failed");
  }
  return tokenSet(body, now);
}

/** Token sap het han (con < 5 phut) -> nen lam moi truoc khi goi API. */
export function needsRefresh(auth, now = Date.now()) {
  return !!(auth?.type === "app" && auth.expires_at && now > auth.expires_at - 5 * 60_000);
}
