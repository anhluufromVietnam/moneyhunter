# Money Hunter — API chi tiết

Base URL: `https://moneyhunter.nexlogvn.tech` · Demo page: `/demo`

## Auth

| Loại | Header / vị trí | Khi dùng |
|---|---|---|
| Partner API key | `X-Client-Id` + `X-Api-Key` | `POST /v1/trigger` (máy ↔ máy) |
| Bearer JWT | `Authorization: Bearer <JWT>` | `POST /v1/spin`, management |
| Query token | `?token=` hoặc body `{token}` | `GET /entry`, `POST /v1/spin`, `POST /v1/auth/verify` |

JWT HS256, claim: `{ sub, scope, userId?, iat, exp }`. Tạo token demo:

```bash
node -e "console.log(require('./lib/auth').sign({scope:'admin', sub:'admin'}))"
```

## 1. GET /healthz

```bash
curl -s $BASE/healthz
# {"ok":true,"service":"wheel-provider","time":"..."}
```

## 2. GET /entry — cổng vào vòng quay

Bắt buộc `userId` **và** `token` (thiếu một → `401`).

```bash
curl -s "$BASE/entry?userId=USR_001&token=$TOKEN"
# 200 {"valid":true,"userId":"USR_001","availableTurns":2,"gifts":[...],"payload":{...}}
# 401 {"error":"missing userId or token"} | {"error":"expired"} | {"error":"bad signature"}
```

## 3. POST /v1/auth/verify

```bash
curl -s $BASE/v1/auth/verify -H "Content-Type: application/json" -d '{"token":"<JWT>","userId":"USR_001"}'
# 200 {"valid":true,"userId":"USR_001"}
```

## 4. POST /v1/trigger — cộng lượt (đối tác)

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

## 5. POST /v1/spin — quay (trừ lượt + ghi quà)

```bash
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
# 401 {"error":"missing token"} | {"error":"bad signature"}
# 400 {"error":"userId required"}
# 404 {"error":"user not found"}
# 409 {"error":"no turns left"}       ← hết lượt, phải qua trigger mới quay tiếp
```

Giải thưởng (random weight): `concert_ticket` (MG-SNN), `voucher_50k` (MG-GSM), `voucher_100k` (MG-WM), `voucher_be_50k` (MG-BE).

## 6. Quản lý (admin JWT `scope: admin`)

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

## 7. /token-demo (chỉ cho trang demo)

`GET /token-demo` → trả JWT admin dùng cho nút "Vào app" trên `/demo`. **Không dùng trong production.**
