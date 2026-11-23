# Money Hunter — Hướng dẫn deploy

## Hạ tầng hiện tại

| Thành phần | Giá trị |
|---|---|
| Máy chủ (Lightsail) | `nexlog-prod` — `54.169.224.21` (Singapore Zone A, 4GB RAM / 2 vCPU / 80GB SSD) |
| Key PEM | `~/.ssh/nexlog-2026.pem` |
| Người dùng SSH | `ubuntu` |
| Domain | `moneyhunter.nexlogvn.tech` |
| App | PM2 `moneyhunter` fork, port **8787**, thư mục `~/moneyhunter` |
| HTTPS | Cloudflare Tunnel `nexlog` (`1cf5860b-7cef-4b52-9c7a-1a9b56ed86df`) qua `cloudflared` systemd |

## 1. Thêm / cập nhật code

```bash
# từ máy Mac
scp -i ~/.ssh/nexlog-2026.pem -r /Users/admin/moneyhunter/* ubuntu@54.169.224.21:/tmp/mh/
ssh -i ~/.ssh/nexlog-2026.pem ubuntu@54.169.224.21
cd ~/moneyhunter
npm test                                  # phải 12/12
pm2 restart moneyhunter
pm2 save
pm2 logs moneyhunter --lines 10
```

## 2. Tunnel (chỉ khi cần đổi domain/port)

```bash
# đã thêm 1 lần: cloudflared tunnel route dns nexlog moneyhunter.nexlogvn.tech
# ingress nằm trong /etc/cloudflared/config.yml:
#   - hostname: moneyhunter.nexlogvn.tech
#     service: http://127.0.0.1:8787
sudo cp /etc/cloudflared/config.yml /etc/cloudflared/config.yml.bak
# sửa ingress rồi:
sudo systemctl restart cloudflared
sudo systemctl status cloudflared --no-pager
```

> ⚠️ Đừng tách tunnel riêng cho moneyhunter — giữ chung tunnel `nexlog` vì
> đúng zone `nexlogvn.tech`. Tunnel cũ `4cbea533… (moneyhunter)` tạo lúc thử nghiệm
> không có connection nào, có thể xóa: `cloudflared tunnel delete 4cbea533-b62c-4571-8487-becce552f260`.

## 3. Kiểm chứng sau deploy

```bash
curl -s https://moneyhunter.nexlogvn.tech/healthz
# {"ok":true,"service":"wheel-provider",...}

TOKEN=$(curl -s https://moneyhunter.nexlogvn.tech/token-demo | node -e "const d=process.stdin;let t='';d.on('data',c=>t+=c);d.on('end',()=>console.log(JSON.parse(t).token))")
curl -s -X POST https://moneyhunter.nexlogvn.tech/v1/trigger \
  -H "X-Client-Id: mygreen" -H "X-Api-Key: mygreen_api_key_test" \
  -H "Content-Type: application/json" -d '{"userId":"USR_001","amount":1}'
curl -s https://moneyhunter.nexlogvn.tech/demo | head -5
```

## 4. Biến môi trường production

| Biến | Mô tả |
|---|---|
| `PORT` | Cổng listen (mặc định `8787`) |
| `JWT_SECRET` | Secret ký JWT — **bắt buộc đổi ở production** (`lib/auth.js`) |
| `MYGREEN_API_KEY` | Api-Key của partner qua header `X-Api-Key` |
| `MYGREEN_WEBHOOK` / `MYGREEN_WEBHOOK_SECRET` | (tùy chọn, nếu thêm webhook) |
| `NODE_ENV=production` | Set trong `ecosystem.config.js` |

## 5. Rollback

```bash
# PM2
pm2 restart moneyhunter          # restart app hiện tại
pm2 list                          # xem trạng thái

# Tunnel
sudo cp /etc/cloudflared/config.yml.bak /etc/cloudflared/config.yml
sudo systemctl restart cloudflared

# DNS (nếu thêm subnet nhầm zone edu-verse)
# cloudflared tunnel không có route delete — xóa CNAME trong Cloudflare Dashboard
```

## 6. Lưu ý bảo mật

* Không commit secret (`JWT_SECRET`, API key production, `~/.ssh/*.pem`) vào git — xem `.gitignore`.
* `/token-demo` chỉ phục vụ `/demo` — tắt ở production.
* Dữ liệu hiện in-memory → restart server là reset. Chưa dùng cho hệ thống tính tiền thật.
