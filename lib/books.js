// Books: in-memory store (replace with DB later). One record per userId.
const crypto = require('crypto');

const users = new Map();
const prizePool = [
  { id: 'concert_ticket', label: '01 cặp vé Concert Sao Nhập Ngũ 2026', codePrefix: 'MG-SNN', weight: 15 },
  { id: 'voucher_50k', label: '01 Voucher 50.000đ Green SM', codePrefix: 'MG-GSM', weight: 30 },
  { id: 'voucher_100k', label: '01 Voucher 100.000đ WinMart', codePrefix: 'MG-WM', weight: 30 },
  { id: 'voucher_be_50k', label: '01 Voucher 50.000đ beTransport', codePrefix: 'MG-BE', weight: 25 },
];
function pickPrize() {
  const total = prizePool.reduce((a, p) => a + p.weight, 0);
  let r = Math.random() * total;
  for (const p of prizePool) { if ((r -= p.weight) <= 0) return p; }
  return prizePool[0];
}
function now() { return new Date().toISOString(); }
function makeCode(prefix) { return `${prefix}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; }

// create user if missing — core for trigger flow
function getOrCreateUser(userId) {
  if (typeof userId !== 'string' || !userId.trim()) return null;
  if (!users.has(userId)) {
    users.set(userId, { userId, turns: 0, totalEarned: 0, totalSpent: 0, gifts: [], history: [], createdAt: now() });
  }
  return users.get(userId);
}
function getUser(userId) { return users.get(userId) || null; }
function listUsers() { return [...users.values()]; }

// Trigger: +N turns to userId
function triggerAddTurn(userId, amount = 1, source = 'manual') {
  const u = getOrCreateUser(userId);
  if (!u) return { error: 'userId required' };
  const n = Number.isInteger(amount) ? amount : parseInt(amount, 10);
  if (!n || n <= 0) return { error: 'amount must be positive integer' };
  u.turns += n; u.totalEarned += n;
  const evt = { type: 'trigger', amount: n, source, at: now(), turnsAfter: u.turns };
  u.history.push(evt);
  return { userId: u.userId, added: n, availableTurns: u.turns, totalEarned: u.totalEarned };
}

// Adjust (admin management)
function adjustTurns(userId, delta) {
  const u = getOrCreateUser(userId);
  if (!u) return { error: 'userId required' };
  const d = Number.isInteger(delta) ? delta : parseInt(delta, 10);
  if (!Number.isInteger(d)) return { error: 'delta must be integer' };
  if (u.turns + d < 0) return { error: 'turns cannot go negative' };
  u.turns += d;
  u.history.push({ type: 'adjust', delta: d, at: now(), turnsAfter: u.turns });
  return { userId: u.userId, availableTurns: u.turns };
}

// Spin: deduct 1 turn, add gift to userId. Atomic in-memory.
function spin(userId) {
  const u = getUser(userId);
  if (!u) return { error: 'user not found', status: 404 };
  if (u.turns <= 0) return { error: 'no turns left', status: 409 };
  u.turns -= 1; u.totalSpent += 1;
  const p = pickPrize();
  const gift = { giftId: 'gift_' + crypto.randomBytes(6).toString('hex'), prizeId: p.id, label: p.label, code: makeCode(p.codePrefix), expiresAt: '2026-12-15T00:00:00Z', grantedAt: now() };
  u.gifts.push(gift);
  u.history.push({ type: 'spin', giftId: gift.giftId, prizeId: p.id, code: gift.code, at: now(), turnsAfter: u.turns });
  return { spinId: 'spin_' + crypto.randomBytes(6).toString('hex'), userId: u.userId, remaining: u.turns, gift };
}

function userSummary(u) {
  return { userId: u.userId, availableTurns: u.turns, totalEarned: u.totalEarned, totalSpent: u.totalSpent, giftCount: u.gifts.length, createdAt: u.createdAt };
}
function seed() {
  getOrCreateUser('USR_001'); getUser('USR_001').turns = 2; getUser('USR_001').totalEarned = 2;
  getOrCreateUser('USR_002');
}
seed();
module.exports = { getOrCreateUser, getUser, listUsers, triggerAddTurn, adjustTurns, spin, userSummary };
