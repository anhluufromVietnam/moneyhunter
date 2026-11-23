// Zero-dep JWT HS256
const crypto = require('crypto');
const SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
function b64u(b) { return Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function fromB64u(s) { return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); }
function sign(payload, { expiresInSec = 86400 } = {}) {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const b = b64u(JSON.stringify({ ...payload, iat: now, exp: now + expiresInSec }));
  const sig = crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${h}.${b}.${sig}`;
}
function verify(token) {
  if (!token || typeof token !== 'string') return { valid: false, error: 'missing token' };
  const p = token.split('.');
  if (p.length !== 3) return { valid: false, error: 'malformed token' };
  const [h, b, sig] = p;
  const exp = crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return { valid: false, error: 'bad signature' };
  let payload; try { payload = JSON.parse(fromB64u(b).toString()); } catch { return { valid: false, error: 'bad payload' }; }
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return { valid: false, error: 'expired' };
  return { valid: true, payload };
}
function needScope(payload, scope) { return !!payload && (payload.scope === scope || payload.scope === 'admin'); }
module.exports = { sign, verify, needScope };
