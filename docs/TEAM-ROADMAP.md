# Money Hunter — Kế hoạch phân việc & runway cho team

> Team: **1 expert + 1 fresh**. Mục tiêu: biến khung hiện tại (in-memory + vòng quay đơn giản) thành
> sản phẩm production có DB, auth thật, quà thật, webhook và CI/CD — mà fresh vẫn ship được từng bước nhỏ.

---

## 1. Nguyên tắc chia việc

| Nguyên tắc | Vì sao |
|---|---|
| Expert giữ **biên hệ thống** (auth, DB, API contract, deploy) | Lỗi ở đây ảnh hưởng toàn cục |
| Fresh giữ **vòng quay UI + nội dung** (cả màn quay, modal, copy, hình ảnh, quà hiển thị) | Giá trị cao, rủi ro thấp, học nhanh |
| Mỗi task ≤ 1–2 ngày, có test rõ ràng | Tránh task to tắc |
| Mọi PR phải qua `npm test` + xem `/demo` | Fresh học quy trình production ngay từ đầu |
| Không ai tự ý đổi contract API khi chưa bàn | Tránh vỡ tích hợp đối tác |

---

## 2. Sprint 1 — Chốt nền (Expert chủ đạo, Fresh hỗ trợ)

**Owner: EXPERT — làm trước, Fresh review theo**

### E1.1 JWT production (0.5 ngày)
- [ ] Thay `JWT_SECRET` hardcoded trong `lib/auth.js` bằng `process.env.JWT_SECRET` (bắt buộc khi `NODE_ENV=production`, thiếu → crash lúc boot).
- [ ] Thêm RS256 (keypair) — giữ HS256 chỉ cho local/test.
- [ ] Token theo `userId` (hiện vừa là `admin` vừa là user — tách 2 scope: `partner` cho trigger, `player` cho spin, `admin` cho management).
- [ ] Test: hết hạn, sai chữ ký, scope sai → đều 401.

### E1.2 DB layer thay in-memory (1 ngày)
- [ ] `lib/books.js` → `lib/store.js` interface: `getOrCreateUser`, `triggerAddTurn`, `spin`, `listUsers`, `adjust`.
- [ ] Adapter đầu tiên: **PostgreSQL** (Lightsail DB hoặc Docker Postgres) — bảng `users`, `turns`, `gifts`, `history`.
- [ ] Wrapper transaction cho `spin` (trừ lượt + ghi quà trong 1 transaction).
- [ ] Migration script `migrations/001_init.sql`, seed 1 user test.
- [ ] Giữ adapter `memory` cho test để `npm test` vẫn chạy zero-dep.

### E1.3 Giám sát API contract (0.5 ngày)
- [ ] OpenAPI/Swagger yaml ở `docs/openapi.yaml` cho 8 endpoints (xin mẫu từ Fresh viết draft).
- [ ] Contract test: `test/contract.sh` curl theo spec trên local + `/demo`.
- [ ] Versioning `/v1` rõ, lỗi trả `code` máy đọc được (`{error:{code,message}}`).

### F1.1 UI vòng quay production (1 ngày — Fresh chính)
- [ ] Vòng quay có **8 ô quà thật** với label rõ ràng (không random conic nữa) — Expert cung cấp JSON `prizes` shape.
- [ ] Modal trúng quà: hiện mã quà lớn, HSĐ, nút "Lưu vào ví My Green" (link stub).
- [ ] Trạng thái hết lượt → nút dẫn về app đối tác (deep link stub).
- [ ] Mobile-first, Nunito + Be Vietnam Pro, đạt contrast.

### F1.2 Copy & nội dung quà (0.5 ngày — Fresh chính)
- [ ] Viết lại mọi text trên `public/wheel.html` (không dùng "endpoint", "token" với user).
- [ ] 4 mã quà demo → text thật: Concert Sao Nhập Ngũ, Green SM 50K, WinMart 100K, be 50K.
- [ ] Trang `/demo` giữ lại nhưng ghi rõ "chỉ dev".

---

## 3. Sprint 2 — Đối tác thật (Expert + Fresh cùng)

### E2.1 Webhook đối tác (1 ngày)
- [ ] `POST /v1/webhooks/partner` nhận event từ My Green (đặt xe, tiết kiệm, thanh toán) → tự gọi `triggerAddTurn`.
- [ ] Chữ ký webhook HMAC-SHA256, chống replay (timestamp 5'), idempotency key.
- [ ] Retry queue + DLQ (BullMQ / PG outbox).

### E2.2 Partner management (0.5 ngày)
- [ ] Mỗi partner 1 `apiKey` (rotation), scope, giới hạn rate.
- [ ] Dashboard `/admin/partners` (bắt đầu bằng trang tĩnh + API thật).

### F2.1 Treo quà & HSĐ (1 ngày — Fresh)
- [ ] Danh sách quà: ảnh, tên, HSĐ, lượt còn lại — lấy từ API `GET /v1/prizes`.
- [ ] "Quà của tôi" tab trong vòng quay: list quà đã trúng, mã, trạng thái (chưa dùng/đã dùng/đã hết hạn).
- [ ] Empty state khi chưa trúng quà.

### E2.3 Rate-limit + chống gian lận (0.5 ngày)
- [ ] Spin max 10/phút/user, một token chỉ dùng 1 lần cho 1 spin_id.
- [ ] Log mọi spin vào `history` + alert khi tỉ lệ trúng vé concert bất thường.

---

## 4. Sprint 3 — Production hoá (cả team)

| Task | Owner | Output |
|---|---|---|
| Docker + CI | Expert | `Dockerfile`, `docker-compose.yml` (app + PG + Redis), GitHub Actions `npm test` + build |
| Backup PG | Expert | cron `pg_dump` → S3, test restore 1 lần |
| Logo/ảnh quà thật | Fresh | thay emoji bằng PNG/SVG, chia 1x/2x/3x |
| E2E test Playwright | Fresh (Expert review) | quay 1 lượt thật trên staging |
| README + CONTRIBUTING | Fresh | người mới clone là chạy được |
| Monitoring | Expert | `/healthz` + PM2 logs + UptimeRobot, alert token 401 tăng bất thường |

---

## 5. Phân công đề xuất (chéo theo 2 người)

### Expert
1. `E1.1` JWT prod + scope
2. `E1.2` DB + transaction
3. `E2.1` Webhook + signature
4. `E2.3` Rate-limit/antifraud
5. Dockerfile + CI + backup
6. Mentor: review PR của Fresh, tách contract `prizes` JSON cho UI

### Fresh
1. `F1.1` UI vòng quay (8 ô, modal, hết lượt)
2. `F1.2` Copy + quà content
3. `F2.1` Quà của tôi + treo quà
4. E2E test Playwright
5. Assets quà (PNG/SVG)
6. Viết draft `docs/openapi.yaml` cho Expert chốt

**Fresh deliverable cuối Sprint 1:** màn quay chỉ hiển thị khi vào `/entry?...`, quay được 1 lượt thật,
modal hiện mã quà đúng format `MG-XXXX-YYYY`. **Expert deliverable:** `npm test` qua cả trên PG.

---

## 6. Definition of Done (áp dụng mọi task)

- [ ] `npm test` xanh, không vỡ contract cũ
- [ ] `/demo` + `/entry` chạy tay được trên laptop và trên staging (`moneyhunter.nexlogvn.tech`)
- [ ] Không hardcode secret; đọc từ `.env` (`.env.example` có trong repo)
- [ ] Commit + push vào `main`, nhắn link repo cho người review
- [ ] Cập nhật `docs/API.md` nếu đổi endpoint
