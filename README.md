# 🎡 Money Hunter — Wheel Provider (Bên thứ 3)

> Vòng quay thưởng **độc lập** do Provider vận hành. Đối tác (My Green / Green SM / be) chỉ gắn 1 nút
> trigger để cộng lượt quay theo `userId`; vòng quay + quà nằm hoàn toàn phía Provider.
> Live: https://moneyhunter.nexlogvn.tech · Repo: `anhluufromVietnam/moneyhunter`
> Auth: **Cookie HttpOnly + Secure** — token chỉ qua URL 1 lần lúc vào cửa, xong server set cookie rồi redirect về URL sạch `/wheel`.

[![Node 20+](https://img.shields.io/badge/node-20%2B-green)](https://nodejs.org) [![Zero deps](https://img.shields.io/badge/deps-0%20npm%20packages-blue)](package.json) [![Tests](https://img.shields.io/badge/tests-18%2F18%20passed-brightgreen)](test/run.js)

---

## 🔗 Link mẫu vào vòng quay — COPY & DÁN

> **Đây là link duy nhất đối tác cần gắn vào app.** User bấm icon → trình duyệt mở link này →
> server verify 1 lần → set cookie HttpOnly → **302 về `/wheel` sạch URL** → ở lại màn quay.
> Token chỉ nằm trên URL lần đầu; sau đó trình duyệt tự gửi cookie, JS không thấy token.

**Link live (copy nguyên xi):**

```text
https://moneyhunter.nexlogvn.tech/entry?userId=USR_001&token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzY29wZSI6ImFkbWluIiwic3ViIjoiYWRtaW4iLCJpYXQiOjE3OTU0MzQ4ODMsImV4cCI6MTc5NTUyMTI4M30.cDamjW-ZBVm9HKOnsI2KQbus1NV7953IFf0SRLUBl9Y
```

**Tự tạo link cho userId khác** (chỉ thay `USR_001`):

```bash
TOKEN=$(curl -s https://moneyhunter.nexlogvn.tech/token-demo | node -e "const d=process.stdin;let t='';d.on('data',c=>t+=c);d.on('end',()=>console.log(JSON.parse(t).token))")
echo "https://moneyhunter.nexlogvn.tech/entry?userId=THAY_USERID_CUA_BAN&token=$TOKEN"
```

> Ngoài ra còn 3 link phụ: xem bảng link đầy đủ ở [§ Hướng dẫn tích hợp](#hướng-dẫn-tích-hợp-cho-đối-tác) bên dưới.

---

## 1. Bối cảnh & vấn đề <!-- xếp lên trên có thể, nhưng giữ nguyên để không mất link anchor -->

Flow cũ (dùng chung UI với My Green) chồng chéo trách nhiệm:

* Điểm xanh + quà + vòng quay đều nằm trong một app → khó bảo mật, khó mở rộng đối tác.
* User ấn vào icon là vào thẳng quay, không qua xác thực → dễ giả mạo lượt quay.
* Không có cách quản lý quà/lượt theo từng người.

**Giải pháp:** tách thành **Wheel Provider** độc lập:

| Bên | Việc |
|---|---|
| **Đối tác** (My Green, Green SM, be…) | Chỉ gọi `POST /v1/trigger {userId}` khi user bấm nút (đặt xe, giữ tiết kiệm, thanh toán). |
| **Provider** (repo này) | Sở hữu vòng quay, lượt quay, quà, xác thực token, quản lý theo `userId`. |
| **User** | Vào vòng quay qua deep link `?userId=&token=` 1 lần → cookie `mh_session` HttpOnly → ở lại `/wheel` sạch URL. |

---

## 2. Kiến trúc

```
┌──────────────┐   ① trigger (+lượt)    ┌───────────────────────┐
│ Partner App  │ ─────────────────────► │  Money Hunter Provider│
│ (My Green…)  │   X-Client-Id/Api-Key  │  Node 20 · zero-dep   │
└──────────────┘                         │  https://moneyhunter. │
        │                              │  nexlogvn.tech        │
        │ ② /entry?userId=&token= (1 lần)│                       │
        └──────────────────────────────│─► verify → Set-Cookie │
                                        │  mh_session HttpOnly  │
                                        │  Secure + SameSite=Lax│
                                        │  302 → /wheel (URL sạch)│
                                        │                       │
                                        │  ③ POST /v1/spin      │
                                        │  (cookie tự gửi, JS   │
                                        │   không thấy token, chỉ│
                                        │   gửi userId)          │
                                        │  -1 lượt + ghi quà     │
                                        └───────────────────────┘
                                                │
                                        ④ GET/PATCH /v1/users/*
                                           (admin JWT, quản lý)
```

* **Trigger (+lượt):** idempotent-ish, tạo `userId` nếu chưa tồn tại, lưu event vào `history`.
* **Spin (−lượt + quà):** nguyên tử trong bộ nhớ — trừ 1 lượt **và** ghi quà cùng một bước. Hết lượt → `409`.
* **Entry gate + cookie:** `/entry?userId=&token=` thiếu 1 → `401` (browser → trang 401, API → JSON). Đủ → Set-cookie HttpOnly+Secure+SameSite=Lax rồi 302 về `/wheel`. Token không ở lại URL, JS không đọc được token, chỉ gọi `GET /v1/session` để hiển thị số lượt.
* **Quản lý:** admin JWT theo `userId`: xem summary, gifts, history, điều chỉnh lượt. `POST /logout` xóa cookie.

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
* **Browser:** HttpOnly cookie `mh_session` (token JWT) + `mh_uid`. Set 1 lần ở `GET /entry?userId=&token=` (browser) rồi 302 về `/wheel` sạch. JS không thấy token, chỉ gọi `GET /v1/session` để hiển thị lượt.
* **Spin (curl fallback):** `Authorization: Bearer <token>` hoặc body `{token}`.
* **Admin:** `Authorization: Bearer <admin JWT>` cho management.
  Tạo token admin demo: `node -e "console.log(require('./lib/auth').sign({scope:'admin'}))"`.
* JWT payload: `{ sub, scope, userId?, iat, exp }` — role `admin` cho management.

### Endpoints

| # | Method | Path | Auth | Body / Query | Response (2xx) |
|---|---|---|---|---|---|
| 1 | GET | `/healthz` | — | — | `{ok:true, service, time}` |
| 2 | GET | `/entry` | query 1 lần | `?userId=&token=` | Browser → `302 /wheel` + Set-Cookie; API → `{valid, userId, availableTurns, gifts}` |
| 3 | GET | `/wheel` | cookie | — | HTML vòng quay (401 page nếu thiếu cookie) |
| 4 | GET | `/v1/session` | cookie | — | `{userId, availableTurns, gifts}` |
| 5 | POST | `/logout` | cookie | — | `{ok:true}` + xóa cookie |
| 6 | POST | `/v1/auth/verify` | body/token/cookie | `{token, userId?}` | `{valid:true, userId}` |
| 7 | POST | `/v1/trigger` | partner | `{userId, amount=1, source?}` | `{userId, added, availableTurns, totalEarned}` |
| 8 | POST | `/v1/spin` | cookie/Bearer/body | `{userId, token? (fallback)}` | `{spinId, userId, remaining, gift}` |
| 9 | GET | `/v1/users` | admin | — | `{users:[summary…]}` |
| 10 | GET | `/v1/users/:userId` | admin | — | `{summary, gifts, history}` |
| 11 | PATCH | `/v1/users/:userId/turns` | admin | `{delta:+1|-1}` | `{userId, availableTurns}` |

Lỗi hay gặp: `401 missing userId or token` (entry), `401 missing session cookie` (session/wheel),
`401 missing X-Client-Id / X-Api-Key` (trigger), `401 admin token required`, `404 user not found`, `409 no turns left`.

### Ví dụ curl (live)

```bash
BASE=https://moneyhunter.nexlogvn.tech
# 1) Đối tác cộng 1 lượt
curl -s $BASE/v1/trigger \
  -H "X-Client-Id: mygreen" -H "X-Api-Key: mygreen_api_key_test" \
  -H "Content-Type: application/json" -d '{"userId":"USR_001","amount":1,"source":"btn"}'
# → {"userId":"USR_001","added":1,"availableTurns":3,"totalEarned":3}

# 2) Vào app bằng browser — token chỉ qua URL 1 lần, xong set cookie + 302 về /wheel sạch
TOKEN=$(curl -s $BASE/token-demo | node -e "const d=process.stdin;let t='';d.on('data',c=>t+=c);d.on('end',()=>console.log(JSON.parse(t).token))")
curl -s -H 'Accept: text/html' "$BASE/entry?userId=USR_001&token=$TOKEN" -L -c jar.txt
# jar giờ có mh_session HttpOnly Secure — token không còn trên URL

# 3) Quay bằng cookie (JS thật) — không cần token trong body
curl -s -b jar.txt $BASE/v1/spin -H "Content-Type: application/json" \
  -d '{"userId":"USR_001"}'
# → {"spinId":"spin_...","remaining":2,"gift":{...,"prizeId":"concert_ticket","code":"MG-SNN-XXXX"}}

# 4) Xem session/lượt (wheel.html gọi endpoint này)
curl -s -b jar.txt $BASE/v1/session

# 5) Quản trị theo userId
curl -s $BASE/v1/users/USR_001 -H "Authorization: Bearer $TOKEN"
```

---

## 4. Cách chạy & test

### Local

```bash
npm start          # node server.js → http://localhost:8787
npm test           # 18 tests toàn trình, không cần dependency
open http://localhost:8787/demo
# vào app bằng deep link 1 lần (token qua URL), xong tự về /wheel sạch
open "http://localhost:8787/entry?userId=USR_001&token=<JWT>"
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

## 5. Trang demo & màn quay

* **Màn quay thực tế** (token sạch URL): https://moneyhunter.nexlogvn.tech/wheel
  — vào bằng `GET /entry?userId=&token=` 1 lần → server set cookie HttpOnly → 302 về `/wheel`.
  JS không thấy token, chỉ gọi `GET /v1/session` để đọc lượt.
* **Trang demo vận hành** (chỉ dev): https://moneyhunter.nexlogvn.tech/demo
  * **Cột trái** — 3 bước vận hành thật: Trigger (+lượt) → Vào app (`/entry?userId=&token=`) → Quay (`/v1/spin`).
  * **Giữa** — điện thoại tiền thân của app đối tác (gate → vòng quay → kết quả → quà của tôi).
  * **Cột phải** — quản lý theo `userId` (admin) + nút test toàn trình + log.

---

## 🚀 Hướng dẫn tích hợp cho đối tác

### A. Gắn link vào app (1 bước duy nhất)

```text
https://moneyhunter.nexlogvn.tech/entry?userId=USR_001&token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzY29wZSI6ImFkbWluIiwic3ViIjoiYWRtaW4iLCJpYXQiOjE3OTU0MzQ4ODMsImV4cCI6MTc5NTUyMTI4M30.cDamjW-ZBVm9HKOnsI2KQbus1NV7953IFf0SRLUBl9Y
```

Thay `USR_001` bằng `userId` thật của người dùng. Mở link trên trình duyệt là vào đúng màn
quay, không qua menu/giữa. Cookie `mh_session` HttpOnly + Secure được set tự động, URL sạch ngay.

### B. Cộng lượt quay (khi user hoàn thành nhiệm vụ)

```bash
curl -s https://moneyhunter.nexlogvn.tech/v1/trigger \
  -H "X-Client-Id: mygreen" -H "X-Api-Key: mygreen_api_key_test" \
  -H "Content-Type: application/json" \
  -d '{"userId":"USR_001","amount":1,"source":"mygreen-button"}'
# => {"userId":"USR_001","added":1,"availableTurns":3,"totalEarned":3}
```

Chưa có `userId` thì tự tạo. Gọi 1 lần cho mỗi nhiệm vụ (đặt xe, gửi tiết kiệm, thanh toán).

### C. Quay (không cần gọi thủ công — vòng quay tự trừ)

User quay trong `/wheel` → JS tự gọi `POST /v1/spin` kèm cookie → 1 lượt bị trừ, quà được ghi thẳng vào `userId` (không cần truyền token). Hết lượt → `409 no turns left`, hiện nút về app đối tác.

### D. Bảng link đầy đủ

| Link | Dùng cho | Ghi chú |
|---|---|---|
| `/entry?userId=&token=` | **Gắn vào app đối tác** (icon quay thưởng) | Cửa duy nhất token qua URL; xong set cookie + 302 `/wheel` sạch |
| `/wheel` | Màn quay thực tế sau khi đã có cookie | Đừng gắn trực tiếp — chưa có cookie sẽ về `401` |
| `/demo` | Dev test toàn trình (trigger/entry/spin/mgmt) | Không cho user thật dùng |
| `/healthz` | Giám sát uptime | Trả `{"ok":true}` |

### E. Lỗi thường gặp

* `401 missing userId or token` → link thiếu 1 trong 2 tham số.
* `401 missing session cookie` → vào thẳng `/wheel` khi chưa qua `/entry`.
* `409 no turns left` → chưa trigger lượt nào cho `userId` này.
* Cookie không lưu (WebView) → app đối tác phải bật lưu cookie / cho phép trình duyệt mở link ngoài.

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
│   ├── session.js       # HttpOnly cookie mh_session/mh_uid (set/parse/clear)
│   ├── books.js         # store users/turns/gifts (in-memory)
│   └── router.js        # tất cả route /v1/* + /entry + /wheel + static demo
├── public/
│   ├── wheel.html       # màn quay thực tế — chỉ đọc cookie, URL sạch (/wheel)
│   └── index.html       # trang demo vận hành (3 cột) — chỉ cho dev
├── test/run.js          # 18 tests end-to-end (fetch, không cần test framework)
├── docs/
│   ├── API.md           # chi tiết request/response
│   ├── DEPLOY.md        # hướng dẫn deploy Lightsail + tunnel
│   └── TEAM-ROADMAP.md  # phân việc expert / fresh + sprint plan
├── ecosystem.config.js  # PM2
└── package.json         # zero deps
```

*Xem [`docs/API.md`](docs/API.md) để xem schema đầy đủ và [`docs/DEPLOY.md`](docs/DEPLOY.md) để deploy từ đầu.*
*Xem [`docs/TEAM-ROADMAP.md`](docs/TEAM-ROADMAP.md) để chia việc cho team.*
