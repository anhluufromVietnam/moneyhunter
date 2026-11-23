# 🎡 Money Hunter — Wheel Provider (Bên thứ 3)

> Vòng quay thưởng **độc lập** do Provider vận hành. Đối tác (My Green / Green SM / be) chỉ gắn 1 nút
> trigger để cộng lượt quay theo `userId`; vòng quay + quà nằm hoàn toàn phía Provider.
> Live: https://moneyhunter.nexlogvn.tech · Repo: `anhluufromVietnam/moneyhunter`

[![Node 20+](https://img.shields.io/badge/node-20%2B-green)](https://nodejs.org) [![Zero deps](https://img.shields.io/badge/deps-0%20npm%20packages-blue)](package.json) [![Tests](https://img.shields.io/badge/tests-12%2F12%20passed-brightgreen)](test/run.js)

---

## 1. Bối cảnh & vấn đề

Flow cũ (dùng chung UI với My Green) chồng chéo trách nhiệm:

* Điểm xanh + quà + vòng quay đều nằm trong một app → khó bảo mật, khó mở rộng đối tác.
* User ấn vào icon là vào thẳng quay, không qua xác thực → dễ giả mạo lượt quay.
* Không có cách quản lý quà/lượt theo từng người.

**Giải pháp:** tách thành **Wheel Provider** độc lập:

| Bên | Việc |
|---|---|
| **Đối tác** (My Green, Green SM, be…) | Chỉ gọi `POST /v1/trigger {userId}` khi user bấm nút (đặt xe, giữ tiết kiệm, thanh toán). |
| **Provider** (repo này) | Sở hữu vòng quay, lượt quay, quà, xác thực token, quản lý theo `userId`. |
| **User** | Vào vòng quay qua deep link `?userId=&token=` từ app đối tác. |

---

## 2. Kiến trúc

```
┌──────────────┐   ① trigger (+lượt)    ┌───────────────────────┐
│ Partner App  │ ─────────────────────► │  Money Hunter Provider│
│ (My Green…)  │   X-Client-Id/Api-Key  │  Node 20 · zero-dep   │
└──────────────┘                         │  https://moneyhunter. │
        │                              │  nexlogvn.tech        │
        │ ② deep link ?userId=&token=   │                       │
        └──────────────────────────────│─►  /entry (gate 401)   │
                                        │                       │
                                        │  ③ POST /v1/spin      │
                                        │     -1 lượt + ghi quà │
                                        │     vào userId         │
                                        └───────────────────────┘
                                                │
                                        ④ GET/PATCH /v1/users/*
                                           (admin JWT, quản lý)
```

* **Trigger (+lượt):** idempotent-ish, tạo `userId` nếu chưa tồn tại, lưu event vào `history`.
* **Spin (−lượt + quà):** nguyên tử trong bộ nhớ — trừ 1 lượt **và** ghi quà cùng một bước. Hết lượt → `409`.
* **Entry gate:** thiếu `userId` hoặc `token` → `401` (chống vào thẳng bằng link).
* **Quản lý:** admin JWT theo `userId`: xem summary, gifts, history, điều chỉnh lượt.

### Trạng thái dữ liệu (demo in-memory → production DB)

```js
users: Map<userId, {
  userId, turns,                      // lượt hiện có
  totalEarned, totalSpent,            // thống kê
  gifts: [{giftId, prizeId, label, code, expiresAt, grantedAt}],
  history: [{type:'trigger'|'spin'|'adjust', ...}],
  createdAt
}>
```

> Production: thay `lib/books.js` bằng PostgreSQL/Redis — giữ nguyên 3 hàm
> `getOrCreateUser / triggerAddTurn / spin`. Các endpoint không cần sửa.

---

## 3. API Reference

### Xác thực

* **Partner trigger:** header `X-Client-Id: <clientId>` + `X-Api-Key: <key>` (xác thực máy ↔ máy).
* **Spin / Entry / Admin:** JWT HS256 (`Authorization: Bearer <token>` hoặc `token` trong body/query).
  Tạo token admin demo: `node -e "console.log(require('./lib/auth').sign({scope:'admin'}))"`.
* JWT payload: `{ sub, scope, userId?, iat, exp }` — role `admin` cho management.

### Endpoints

| # | Method | Path | Auth | Body / Query | Response (2xx) |
|---|---|---|---|---|---|
| 1 | GET | `/healthz` | — | — | `{ok:true, service, time}` |
| 2 | GET | `/entry` | query | `?userId=&token=` | `{valid, userId, availableTurns, gifts}` |
| 3 | POST | `/v1/auth/verify` | body/token | `{token, userId?}` | `{valid:true, userId}` |
| 4 | POST | `/v1/trigger` | partner | `{userId, amount=1, source?}` | `{userId, added, availableTurns, totalEarned}` |
| 5 | POST | `/v1/spin` | Bearer/body | `{userId, token?}` | `{spinId, userId, remaining, gift}` |
| 6 | GET | `/v1/users` | admin | — | `{users:[summary…]}` |
| 7 | GET | `/v1/users/:userId` | admin | — | `{summary, gifts, history}` |
| 8 | PATCH | `/v1/users/:userId/turns` | admin | `{delta:+1|-1}` | `{userId, availableTurns}` |

Lỗi hay gặp: `401 missing userId or token` (entry), `401 missing X-Client-Id / X-Api-Key` (trigger),
`401 admin token required`, `404 user not found`, `409 no turns left`.

### Ví dụ curl (live)

```bash
BASE=https://moneyhunter.nexlogvn.tech
# 1) Đối tác cộng 1 lượt
curl -s $BASE/v1/trigger \
  -H "X-Client-Id: mygreen" -H "X-Api-Key: mygreen_api_key_test" \
  -H "Content-Type: application/json" -d '{"userId":"USR_001","amount":1,"source":"btn"}'
# → {"userId":"USR_001","added":1,"availableTurns":3,"totalEarned":3}

# 2) Vào app (yêu cầu userId + token, thiếu → 401)
TOKEN=$(curl -s $BASE/token-demo | node -e "const d=process.stdin;let t='';d.on('data',c=>t+=c);d.on('end',()=>console.log(JSON.parse(t).token))")
curl -s "$BASE/entry?userId=USR_001&token=$TOKEN"

# 3) Quay: -1 lượt + ghi quà
curl -s $BASE/v1/spin -H "Content-Type: application/json" \
  -d "{\"userId\":\"USR_001\",\"token\":\"$TOKEN\"}"
# → {"spinId":"spin_...","remaining":2,"gift":{...,"prizeId":"concert_ticket","code":"MG-SNN-XXXX"}}

# 4) Quản trị theo userId
curl -s $BASE/v1/users/USR_001 -H "Authorization: Bearer $TOKEN"
```

---

## 4. Cách chạy & test

### Local

```bash
npm start          # node server.js → http://localhost:8787
npm test           # 12 tests toàn trình, không cần dependency
open http://localhost:8787/demo
```

> Zero dependency — chỉ cần Node ≥ 18. Không cần `npm install`.

### Production (Lightsail `nexlog-prod` · `54.169.224.21`)

```bash
ssh -i ~/.ssh/nexlog-2026.pem ubuntu@54.169.224.21
cd ~/moneyhunter
npm test
pm2 restart moneyhunter && pm2 save
```

* PM2 app `moneyhunter` (fork, port **8787**), ecosystem: [`ecosystem.config.js`](ecosystem.config.js).
* HTTPS qua Cloudflare Tunnel `nexlog` (`/etc/cloudflared/config.yml` — đã thêm ingress
  `moneyhunter.nexlogvn.tech → http://127.0.0.1:8787`). Restart tunnel: `sudo systemctl restart cloudflared`.
* DNS: `cloudflared tunnel route dns nexlog moneyhunter.nexlogvn.tech`.

---

## 5. Trang demo

Mở https://moneyhunter.nexlogvn.tech/demo :

* **Cột trái** — 3 bước vận hành thật: Trigger (+lượt) → Vào app (`/entry?userId=&token=`) → Quay (`/v1/spin`).
* **Giữa** — điện thoại tiền thân của app đối tác (gate → vòng quay → kết quả → quà của tôi).
* **Cột phải** — quản lý theo `userId` (admin) + nút test toàn trình + log.

---

## 6. Roadmap production

| Việc | Chi tiết |
|---|---|
| DB thay in-memory | `lib/books.js` → Postgres + unique `userId`, transaction cho `spin` |
| JWT prod | `JWT_SECRET` env riêng, RS256, refresh token, rotation |
| Partner mgmt | `X-Api-Key` quản lý theo partner, rate-limit, IP allowlist |
| Quà thật | Prize pool + mã quà phát qua SMS/webhook thay vì random code demo |
| Vận hành | `.env`, Dockerfile, CI (`npm test` + deploy PM2/systemd), log tập trung |

---

## 7. Cấu trúc repo

```
moneyhunter/
├── server.js            # entry, in JWT demo khi boot
├── lib/
│   ├── auth.js          # JWT HS256 sign/verify
│   ├── books.js         # store users/turns/gifts (in-memory)
│   └── router.js        # tất cả route /v1/* + /entry + static demo
├── public/
│   ├── wheel.html       # màn quay thực tế — GET /entry?userId=&token= (browser) trả file này
│   └── index.html       # trang demo vận hành (3 cột) — chỉ cho dev
├── test/run.js          # 12 tests end-to-end (fetch, không cần test framework)
├── docs/
│   ├── API.md           # chi tiết request/response
│   ├── DEPLOY.md        # hướng dẫn deploy Lightsail + tunnel
│   └── TEAM-ROADMAP.md  # phân việc expert / fresh + sprint plan
├── ecosystem.config.js  # PM2
└── package.json         # zero deps
```

*Xem [`docs/API.md`](docs/API.md) để xem schema đầy đủ và [`docs/DEPLOY.md`](docs/DEPLOY.md) để deploy từ đầu.*
*Xem [`docs/TEAM-ROADMAP.md`](docs/TEAM-ROADMAP.md) để chia việc cho team.*
