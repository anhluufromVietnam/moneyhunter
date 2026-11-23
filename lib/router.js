const { verify } = require('./auth');
const books = require('./books');
const { parseCookies, setSessionCookies, clearSessionCookies, COOKIE_NAME, UID_COOKIE } = require('./session');
const http = require('http');
const fs = require('fs');
const path = require('path');

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Id, X-Api-Key', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { if (d.length < 1e6) d += c; });
    req.on('end', () => { if (!d) return resolve({}); try { resolve(JSON.parse(d)); } catch { resolve({}); } });
  });
}
const PARTNERS = { mygreen: { apiKey: process.env.MYGREEN_API_KEY || 'mygreen_api_key_test' } };
function checkPartner(req) {
  const cid = req.headers['x-client-id']; const key = req.headers['x-api-key'];
  if (!cid || !key) return { error: 'missing X-Client-Id / X-Api-Key' };
  const p = PARTNERS[cid]; if (!p) return { error: 'unknown clientId' };
  if (p.apiKey !== key) return { error: 'bad apiKey' };
  return { clientId: cid };
}
function bearerPayload(req) {
  const a = req.headers['authorization'] || '';
  if (!a.startsWith('Bearer ')) return null;
  const r = verify(a.slice(7)); return r.valid ? r.payload : null;
}
function tokenFromReq(req, body) {
  if (body && body.token) return body.token;
  const a = req.headers['authorization'] || '';
  if (a.startsWith('Bearer ')) return a.slice(7);
  const c = parseCookies(req);
  if (c[COOKIE_NAME]) return c[COOKIE_NAME];
  if (c.mh_session) return c.mh_session;
  return null;
}
function userIdFromReq(body, req) {
  if (body && body.userId) return body.userId;
  const c = parseCookies(req);
  if (c[UID_COOKIE]) return c[UID_COOKIE];
  if (c.mh_uid) return c.mh_uid;
  return null;
}
function renderWheel(res, code = 200) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'wheel.html'), 'utf8');
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  return res.end(html);
}

const routes = [
  ['GET', /^\/healthz$/, (req, res) => json(res, 200, { ok: true, service: 'wheel-provider', time: new Date().toISOString() })],
  ['GET', /^\/token-demo$/, (req, res) => { const { sign } = require('./auth'); json(res, 200, { token: sign({ scope: 'admin', sub: 'admin' }) }); }],

// Entry gate: token chỉ truyền 1 lần qua URL (từ app đối tác).
// Browser (Accept text/html): verify -> Set new Cookie HttpOnly+Secure+SameSite=Lax -> 302 /wheel (URL sạch, không còn token).
// API (Accept */*): JSON như cũ (không set cookie) để curl/postman vẫn test được.
  ['GET', /^\/entry$/, (req, res, m, url) => {
    const q = new URL(req.url, 'http://x').searchParams;
    let userId = q.get('userId'); let token = q.get('token');
    const accept = req.headers['accept'] || '';
    const isBrowser = accept.includes('text/html');
    // Nếu đã có cookie, không cần query nữa — đi thẳng vào /wheel
    const cookies = parseCookies(req);
    const cookieToken = cookies[COOKIE_NAME];
    const cookieUid = cookies[UID_COOKIE];
    if (cookieToken && cookieUid && !q.has('token') && !q.has('userId')) {
      const v = verify(cookieToken);
      if (v.valid) { res.writeHead(302, { Location: '/wheel' }); return res.end(); }
    }
    if (!userId || !token) {
      if (isBrowser) return renderWheel(res, 401);
      return json(res, 401, { error: 'missing userId or token' });
    }
    const r = verify(token);
    if (!r.valid) {
      if (isBrowser) return renderWheel(res, 401);
      return json(res, 401, { error: r.error });
    }
    const u = books.getOrCreateUser(userId);
    if (isBrowser) {
      setSessionCookies(res, token, userId, req);
      res.writeHead(302, { Location: '/wheel', 'Set-Cookie': res.getHeader('Set-Cookie'), 'Cache-Control': 'no-store' });
      return res.end();
    }
    json(res, 200, { valid: true, userId, availableTurns: u.turns, gifts: u.gifts, payload: r.payload });
  }],

  ['POST', /^\/v1\/auth\/verify$/, async (req, res) => {
    const body = await readBody(req);
    const token = tokenFromReq(req, body);
    const r = verify(token);
    if (!r.valid) return json(res, 401, { valid: false, error: r.error });
    return json(res, 200, { valid: true, userId: body.userId || r.payload.userId || null });
  }],

  // TRIGGER: +turns to userId (creates if missing) — partner backend or admin
  ['POST', /^\/v1\/trigger$/, async (req, res) => {
    const chk = checkPartner(req);
    if (chk.error) return json(res, 401, { error: chk.error });
    const body = await readBody(req);
    const r = books.triggerAddTurn(body.userId, body.amount ?? 1, body.source || chk.clientId);
    if (r.error) return json(res, 400, r);
    json(res, 200, r);
  }],

  // SPIN: deduct 1 turn, add gift to userId. Lấy token + userId từ body / Bearer / Cookie (HttpOnly) — ưu tiên body, fallback cookie.
  ['POST', /^\/v1\/spin$/, async (req, res) => {
    const body = await readBody(req);
    const token = tokenFromReq(req, body);
    const v = verify(token);
    if (!v.valid) return json(res, 401, { error: v.error });
    const uid = userIdFromReq(body, req);
    if (!uid) return json(res, 400, { error: 'userId required' });
    // Nếu dùng cookie thì buộc userId phải khớp với cookie và payload (chống sửa userId)
    const c = parseCookies(req);
    const cookieUid = c[UID_COOKIE];
    if (cookieUid && !body.userId && !req.headers['authorization'] && body.userId !== cookieUid && uid !== cookieUid) {
      return json(res, 401, { error: 'userId not in session' });
    }
    if (cookieUid && body.userId && body.userId !== cookieUid && !req.headers['authorization']) {
      return json(res, 401, { error: 'userId must match session cookie' });
    }
    // Nếu token payload có userId thì phải khớp
    if (v.payload.userId && v.payload.userId !== uid) return json(res, 401, { error: 'userId not in token' });
    const r = books.spin(uid);
    if (r.error) return json(res, r.status || 400, r);
    json(res, 200, r);
  }],

  // Management: per userId (admin JWT required)
  ['GET', /^\/v1\/users$/, (req, res) => {
    const p = bearerPayload(req);
    if (!p || p.scope !== 'admin') return json(res, 401, { error: 'admin token required' });
    json(res, 200, { users: books.listUsers().map(books.userSummary) });
  }],
// Quay sạch: /wheel chỉ đọc từ Cookie HttpOnly (không đọc URL query nữa)
  ['GET', /^\/wheel$/, (req, res) => {
    const c = parseCookies(req);
    const token = c[COOKIE_NAME];
    const uid = c[UID_COOKIE];
    if (!token) {
      res.writeHead(302, { Location: '/entry' });
      return res.end();
    }
    const v = verify(token);
    if (!v.valid) {
      clearSessionCookies(res, req);
      res.writeHead(302, { Location: '/entry', 'Set-Cookie': res.getHeader('Set-Cookie') });
      return res.end();
    }
    if (uid) books.getOrCreateUser(uid);
    return renderWheel(res, 200);
  }],
  ['POST', /^\/logout$/, (req, res) => {
    clearSessionCookies(res, req);
    json(res, 200, { ok: true });
  }],
  ['GET', /^\/v1\/session$/, (req, res) => {
    const c = parseCookies(req);
    const token = c[COOKIE_NAME];
    const uid = c[UID_COOKIE];
    if (!token || !uid) return json(res, 401, { error: 'missing session cookie' });
    const v = verify(token);
    if (!v.valid) return json(res, 401, { error: v.error });
    const u = books.getUser(uid);
    if (!u) return json(res, 404, { error: 'user not found' });
    json(res, 200, { userId: uid, availableTurns: u.turns, gifts: u.gifts });
  }],
  ['GET', /^\/v1\/users\/([^/]+)$/, (req, res, m) => {
    const p = bearerPayload(req);
    if (!p || p.scope !== 'admin') return json(res, 401, { error: 'admin token required' });
    const u = books.getUser(decodeURIComponent(m[1]));
    if (!u) return json(res, 404, { error: 'user not found' });
    json(res, 200, { ...books.userSummary(u), gifts: u.gifts, history: u.history });
  }],
  ['PATCH', /^\/v1\/users\/([^/]+)\/turns$/, async (req, res, m) => {
    const p = bearerPayload(req);
    if (!p || p.scope !== 'admin') return json(res, 401, { error: 'admin token required' });
    const body = await readBody(req);
    const r = books.adjustTurns(decodeURIComponent(m[1]), body.delta);
    if (r.error) return json(res, 400, r);
    json(res, 200, r);
  }],
  ['DELETE', /^\/v1\/users\/([^/]+)$/, (req, res, m) => {
    const p = bearerPayload(req);
    if (!p || p.scope !== 'admin') return json(res, 401, { error: 'admin token required' });
    json(res, 200, { deleted: decodeURIComponent(m[1]), note: 'in-memory demo only' });
  }],
];

// Entry: non-browsers (Accept */*) get JSON API; browsers get 302 to /wheel (cookie session).
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const url = (req.url || '').split('?')[0];
  if (url === '/' || url === '/demo') {
    if (url === '/demo') {
      const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    // / -> /wheel if has cookie, else /entry (401 page)
    const c = parseCookies(req);
    if (c[COOKIE_NAME]) {
      res.writeHead(302, { Location: '/wheel' });
      return res.end();
    }
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'wheel.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }
  for (const [method, re, fn] of routes) {
    if (method !== req.method) continue;
    const mm = url.match(re);
    if (!mm) continue;
    await fn(req, res, mm, url);
    return;
  }
  json(res, 404, { error: 'not found', path: url });
});

module.exports = { server };
