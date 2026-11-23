# Money Hunter — API chi tiết

Base URL: `https://moneyhunter.nexlogvn.tech` · Demo page: `/demo`

## Auth — Token KHÔNG còn nằm trên URL sau lần vào đầu

> **Flow mới (Cookie HttpOnly + Secure):** App đối tác vẫn mở deep link 1 lần
> `GET /entry?userId=&token=<JWT>` (Accept: text/html). Server verify 1 lần rồi
> `Set-Cookie: mh_session=<JWT>; HttpOnly; Secure; SameSite=Lax` + `mh_uid=<userId>`
> và **302 redirect về `/wheel`** — URL sau đó sạch, không còn token. Mọi request
> tiếp theo (mở `/wheel`, POST `/v1/spin`, GET `/v1/session`) tự gửi cookie,
> JS **không đọc được** token (XSS không chôm được).

| Loại | Cách truyền | Khi dùng |
|---|---|---|
| Partner API key | `X-Client-Id` + `X-Api-Key` | `POST /v1/trigger` (máy ↔ máy) |
| HttpOnly cookie | `Cookie: mh_session=...; mh_uid=...` (server tự set, browser tự gửi) | `/wheel`, `POST /v1/spin`, `GET /v1/session`, `POST /logout` |
| Bearer JWT | `Authorization: Bearer <JWT>` | `POST /v1/spin` (fallback cho curl/test), management |
| Query token (chỉ entry/API) | `?token=` hoặc body `{token}` | `GET /entry` (Accept */* để test API), `POST /v1/spin` fallback |

JWT HS256, claim: `{ sub, scope, userId?, iat, exp }`. Tạo token demo:

```bash
node -e "console.log(require('./lib/auth').sign({scope:'admin', sub:'admin'}))"
```

## 1. GET /healthz

```bash
curl -s $BASE/healthz
# {"ok":true,"service":"wheel-provider","time":"..."}
```

## 2. GET /entry — cổng vào vòng quay (nơi duy nhất token qua URL)

* **Browser** (`Accept: text/html`): verify → set cookie → `302 Location: /wheel`
* **API** (`Accept: */*`): JSON, không set cookie (cho curl/test)

```bash
# BROWSER — nhận 302 + cookie, trình duyệt tự tới /wheel sạch
curl -s -H 'Accept: text/html' "$BASE/entry?userId=USR_001&token=$TOKEN" -L -c jar.txt
# → /wheel (không còn token trên URL), jar có mh_session HttpOnly Secure

# API — JSON
curl -s "$BASE/entry?userId=USR_001&token=$TOKEN"
# 200 {"valid":true,"userId":"USR_001","availableTurns":2,"gifts":[...],"payload":{...}}
# 401 {"error":"missing userId or token"} | {"error":"expired"} | {"error":"bad signature"}
```

Header trả về (browser): `Set-Cookie: mh_session=...; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=86400` + `mh_uid`.

## 3. GET /wheel — màn quay sạch (chỉ cookie)

```bash
curl -s -b jar.txt $BASE/wheel          # có cookie → 200 HTML quay
curl -s $BASE/wheel                     # không cookie → 302 /entry
```

## 4. GET /v1/session — đọc session từ cookie (cho JS hiển thị lượt)

JS của `wheel.html` **không thấy token**, chỉ gọi endpoint này để lấy `userId/turns/gifts`.

```bash
curl -s -b jar.txt $BASE/v1/session
# 200 {"userId":"USR_001","availableTurns":2,"gifts":[...]}
# 401 {"error":"missing session cookie"} hoặc {"error":"expired"}
```

## 5. POST /logout — đăng xuất (xóa cookie)

```bash
curl -s -b jar.txt -c jar.txt -X POST $BASE/logout
# Set-Cookie: mh_session=; Max-Age=0 ...
# {"ok":true}
```

## 6. POST /v1/auth/verify

```bash
curl -s $BASE/v1/auth/verify -H "Content-Type: application/json" -d '{"token":"<JWT>","userId":"USR_001"}'
# 200 {"valid":true,"userId":"USR_001"}
# Cũng nhận Cookie mh_session nếu có
```

## 7. POST /v1/trigger — cộng lượt (đối tác)

Partner gọi khi user bấm nút trong app đối tác. **Tự tạo `userId` nếu chưa có.**

```bash
curl -s $BASE/v1/trigger \
  -H "X-Client-Id: mygreen" -H "X-Api-Key: mygreen_api_key_test" \
  -H "Content-Type: application/json" \
  -d '{"userId":"USR_001","amount":1,"source":"mygreen-button"}'
# 200 {"userId":"USR_001","added":1,"availableTurns":3,"totalEarned":3}
# 401 {"error":"missing X-Client-Id / X-Api-Key"} | {"error":"unknown clientId"} | {"error":"bad apiKey"}
# 400 {"error":"userId required"} | {"error":"amount must be positive integer"}
```

Body: `userId` (bắt buộc), `amount` (mặc định `1`), `source` (ghi vào history).

## 8. POST /v1/spin — quay (trừ lượt + ghi quà)

Ưu tiên đọc token/userId từ cookie; body/Bearer chỉ fallback cho curl/test.

```bash
# Browser (sau /entry) — chỉ cần cookie, không gửi token
curl -s -b jar.txt $BASE/v1/spin -H "Content-Type: application/json" -d '{"userId":"USR_001"}'

# curl/test — Bearer hoặc body token
curl -s $BASE/v1/spin -H "Content-Type: application/json" \
  -d '{"userId":"USR_001","token":"<JWT>"}'

# 200 {
#   "spinId": "spin_21e30d3bba2d",
#   "userId": "USR_001",
#   "remaining": 2,
#   "gift": {
#     "giftId": "gift_750d5b4efc79",
#     "prizeId": "concert_ticket",
#     "label": "01 cặp vé Concert Sao Nhập Ngũ 2026",
#     "code": "MG-SNN-JIIS",
#     "expiresAt": "2026-12-15T00:00:00Z",
#     "grantedAt": "... }}"
# }
# 401 {"error":"missing token"} | {"error":"bad signature"} | {"error":"userId must match session cookie"}
# 400 {"error":"userId required"}
# 404 {"error":"user not found"}
# 409 {"error":"no turns left"}
```

Giải thưởng (random weight): `concert_ticket` (MG-SNN), `voucher_50k` (MG-GSM), `voucher_100k` (MG-WM), `voucher_be_50k` (MG-BE).

## 9. Quản lý (admin JWT `scope: admin`)

```bash
TOKEN=<admin JWT>

curl -s $BASE/v1/users -H "Authorization: Bearer $TOKEN"
# {"users":[{"userId":"USR_001","availableTurns":2,"totalEarned":3,"totalSpent":1,"giftCount":1,"createdAt":"..."}]}

curl -s $BASE/v1/users/USR_001 -H "Authorization: Bearer $TOKEN"
# {summary fields..., "gifts":[...], "history":[{"type":"trigger",...},{"type":"spin",...}]}

curl -s -X PATCH $BASE/v1/users/USR_001/turns -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"delta":1}'
# {"userId":"USR_001","availableTurns":3}
```

Không có admin token → `401 {"error":"admin token required"}` trên cả 3 endpoint.

## 10. /token-demo (chỉ cho trang demo)

`GET /token-demo` → trả JWT admin dùng cho nút "Vào app" trên `/demo`. **Không dùng trong production.**

## Bảo mật cookie (đã bật)

* `HttpOnly` — JS `document.cookie` không đọc được, chống XSS chôm token. `wheel.html` không tham chiếu token ở đâu.
* `Secure` — chỉ gửi qua HTTPS (tự bỏ qua khi request là localhost http để dev).
* `SameSite=Lax` — chặn gửi cookie khi bị iframe/endpoint lạ POST qua.
* `Max-Age=86400` + `Cache-Control: no-store` trên `/wheel` — không cache màn quay.
* Logout xóa cookie (`Max-Age=0`). Thiếu cookie → `/wheel` 302 về `/entry` (401 page).
