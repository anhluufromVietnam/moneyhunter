const assert = require('node:assert');
const { server } = require('../lib/router');
const { sign } = require('../lib/auth');
let port;
async function start() { return new Promise(r => server.listen(0, () => { port = server.address().port; r(); })); }
async function stop() { return new Promise(r => { server.closeAllConnections(); server.close(r); }); }
async function call(method, path, body, headers) {
  const payload = body ? JSON.stringify(body) : null;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(headers||{}) }, body: payload });
  const j = await res.json().catch(() => ({}));
  return { status: res.status, j, setCookie: res.headers.getSetCookie ? res.headers.getSetCookie() : [] };
}
(async () => {
  await start();
  const jwt = sign({ scope: 'admin', sub: 'admin' });
  const PH = { 'X-Client-Id': 'mygreen', 'X-Api-Key': 'mygreen_api_key_test' };
  const AH = { 'Authorization': `Bearer ${jwt}` };
  let count = 0, pass = 0;
  const ok = (name, cond) => { count++; if (cond) { pass++; console.log(`✔ ${name}`); } else console.log(`✖ ${name}`); };

  let r = await call('GET', '/healthz');
  ok('healthz', r.status === 200 && r.j.ok);

  r = await call('GET', '/entry');
  ok('entry missing params 401', r.status === 401);

  r = await call('GET', `/entry?userId=USR_001&token=${jwt}`);
  ok('entry valid (api)', r.status === 200 && r.j.valid === true);

  // Session cookie: entry browser -> 302 sets mh_session HttpOnly, then /wheel reads cookie
  const entryRes = await fetch(`http://127.0.0.1:${port}/entry?userId=USR_001&token=${jwt}`, {
    headers: { 'Accept': 'text/html' }, redirect: 'manual'
  });
  const setCookies = entryRes.headers.getSetCookie ? entryRes.headers.getSetCookie() : [];
  const sessionCookie = setCookies.find(c => c.startsWith('mh_session='));
  ok('entry browser 302 + set-cookie HttpOnly', entryRes.status === 302 && !!sessionCookie && /HttpOnly/.test(sessionCookie) && /SameSite=Lax/.test(sessionCookie));
  ok('entry browser location clean', (entryRes.headers.get('location') || '').startsWith('/wheel'));
  const cookieHdr = sessionCookie ? sessionCookie.split(';')[0] : '';
  const wheelRes = await fetch(`http://127.0.0.1:${port}/wheel`, { headers: { Cookie: cookieHdr } });
  ok('wheel with cookie 200', wheelRes.status === 200 && (await wheelRes.text()).includes('Quay ngay'));
  const wheelNoCookie = await fetch(`http://127.0.0.1:${port}/wheel`, { redirect: 'manual' });
  ok('wheel no cookie redirects', wheelNoCookie.status === 302);
  const logoutRes = await fetch(`http://127.0.0.1:${port}/logout`, { method: 'POST', headers: { Cookie: cookieHdr } });
  const logoutSetCookie = logoutRes.headers.getSetCookie ? logoutRes.headers.getSetCookie().join(' ') : (logoutRes.headers.get('set-cookie') || '');
  ok('logout clears cookie', logoutRes.status === 200 && logoutSetCookie.includes('Max-Age=0'));

  r = await call('POST', '/v1/trigger', { userId: 'NEW_USER', amount: 2, source: 'btn' }, PH);
  ok('trigger creates user +2', r.status === 200 && r.j.availableTurns === 2);

  r = await call('POST', '/v1/trigger', { userId: 'USR_001', amount: 1 }, PH);
  ok('trigger +1 existing', r.status === 200 && r.j.availableTurns >= 1);

  r = await call('POST', '/v1/trigger', { userId: 'USR_001', amount: 1 });
  ok('trigger no partner key 401', r.status === 401);

  r = await call('POST', '/v1/spin', { userId: 'USR_001', token: jwt }, AH);
  ok('spin deduct + gift', r.status === 200 && !!r.j.gift && r.j.gift.code);

  r = await call('POST', '/v1/spin', { userId: 'USR_001' }, { Cookie: cookieHdr });
  ok('spin with cookie works', r.status === 200 && !!r.j.gift);

  r = await call('POST', '/v1/spin', { userId: 'USR_002', token: jwt }, AH);
  ok('spin no-turns 409', r.status === 409);

  r = await call('POST', '/v1/spin', { userId: 'USR_001' }, {});
  ok('spin no token/cookie 401', r.status === 401);

  r = await call('GET', '/v1/users/USR_001', null, AH);
  ok('management get user gifts>0', r.status === 200 && r.j.gifts.length >= 1);

  r = await call('GET', '/v1/users', null, AH);
  ok('management list', r.status === 200 && Array.isArray(r.j.users));

  r = await call('PATCH', '/v1/users/USR_001/turns', { delta: 1 }, AH);
  ok('management adjust +1', r.status === 200);

  console.log(`\n${pass}/${count} passed`);
  await stop();
  if (pass !== count) process.exit(1);
})();
