// lib/session.js — HttpOnly cookie session (token không nằm trên URL nữa)
const COOKIE_NAME = 'mh_session';
const UID_COOKIE = 'mh_uid';

function parseCookies(req) {
  const h = req.headers.cookie || '';
  const out = {};
  h.split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i < 0) return;
    const k = p.slice(0, i).trim();
    if (!k) return;
    try { out[k] = decodeURIComponent(p.slice(i + 1).trim()); } catch (e) { out[k] = p.slice(i + 1).trim(); }
  });
  return out;
}

function isSecureRequest(req) {
  const xf = req.headers['x-forwarded-proto'];
  if (xf) return xf.split(',')[0].trim() === 'https';
  // Cloudflare tunnel passes x-forwarded-proto=https; localhost http thì bỏ Secure (cookie vẫn HttpOnly)
  const host = req.headers.host || '';
  return !/(localhost|127\.0\.0\.1|192\.168\.|\[::1\])/.test(host);
}

function sessionCookies(token, userId, req, maxAgeSec) {
  const secure = isSecureRequest(req) ? '; Secure' : '';
  const attrs = `Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${maxAgeSec}`;
  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}; ${attrs}`,
    `${UID_COOKIE}=${encodeURIComponent(userId)}; ${attrs}`
  ];
}
function setSessionCookies(res, token, userId, req, maxAgeSec = 86400) {
  res.setHeader('Set-Cookie', sessionCookies(token, userId, req, maxAgeSec));
}
function clearSessionCookies(res, req) {
  const secure = isSecureRequest(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', [
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`,
    `${UID_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`
  ]);
}
module.exports = { parseCookies, setSessionCookies, clearSessionCookies, COOKIE_NAME, UID_COOKIE };
