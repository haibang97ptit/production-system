# Production Deployment Guide

Hướng dẫn deploy hệ thống lên Ubuntu Server.

## 1. Chuẩn bị server (làm 1 lần)

### Cài dependencies

```bash
# Update
sudo apt update && sudo apt upgrade -y

# Docker + docker compose plugin
sudo apt install -y docker.io docker-compose-plugin

# CIFS utils để mount NAS
sudo apt install -y cifs-utils

# Cho phép user hiện tại chạy docker không cần sudo
sudo usermod -aG docker $USER
newgrp docker
```

### Verify Docker

```bash
docker --version
docker compose version
```

## 2. Clone/copy source lên server

```bash
sudo mkdir -p /opt/batch-report-system
sudo chown $USER:$USER /opt/batch-report-system
cd /opt/batch-report-system

# Copy source từ máy dev sang, hoặc git clone
# scp -r batch-report-system/* user@server:/opt/batch-report-system/
```

## 3. Cấu hình `.env`

```bash
cp .env.example .env
nano .env
```

**Bắt buộc phải đổi** những dòng sau:

```env
NODE_ENV=production
LOG_LEVEL=info

# Database - dùng password mạnh
POSTGRES_PASSWORD=<chuỗi random 32+ ký tự>

# Security - BẮT BUỘC set trên production
API_KEY=<chuỗi random 32+ ký tự, sẽ chia sẻ cho MES/QLSX>
CORS_ORIGINS=https://mes.example.com,https://app.example.com

# NAS
NAS_HOST=<IP NAS>
NAS_SHARE=<share folder path>/Batch report
NAS_USER=<service account IT tạo>
NAS_PASS=<password của service account>

# Sync - production không cần chạy ngay, đợi cron
SYNC_ON_STARTUP=false
SYNC_CONCURRENCY=10
```

**Tạo password/API key ngẫu nhiên:**
```bash
openssl rand -base64 32
```

### Bảo vệ file .env

```bash
chmod 600 .env
```

## 4. Deploy lần đầu

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Đợi ~2-3 phút cho build xong. Kiểm tra:

```bash
# Container đang chạy?
docker compose ps

# API OK?
curl http://localhost:3000/api/health

# Log
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f app
```

## 5. Setup reverse proxy (nginx) — khuyến nghị

Cấu hình nginx trước Docker giúp có HTTPS, log tập trung, dễ scale:

```nginx
# /etc/nginx/sites-available/batch-report
server {
    listen 80;
    server_name batch-api.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name batch-api.example.com;

    ssl_certificate     /etc/letsencrypt/live/batch-api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/batch-api.example.com/privkey.pem;

    # Chỉ cho phép IP nội bộ nếu là API nội bộ
    # allow 10.0.0.0/8;
    # deny all;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
    }
}
```

Enable + reload:
```bash
sudo ln -s /etc/nginx/sites-available/batch-report /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 6. Tự động backup DB

Setup cron backup hàng ngày lúc 2h sáng:

```bash
chmod +x scripts/backup-db.sh scripts/restore-db.sh

# Thêm vào crontab
crontab -e
```

Thêm dòng:
```
0 2 * * * cd /opt/batch-report-system && ./scripts/backup-db.sh /var/backups/batch-reports >> /var/log/batch-backup.log 2>&1
```

## 7. Firewall

```bash
sudo ufw allow 22/tcp     # SSH
sudo ufw allow 443/tcp    # HTTPS (nginx)
sudo ufw allow 80/tcp     # HTTP (redirect)
sudo ufw enable
```

Không mở port 3000 ra ngoài — chỉ nginx local access.

## 8. Monitoring

### Xem log realtime
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f --tail 100 app
```

### Xem status
```bash
curl -s http://localhost:3000/api/health | jq
```

### Xem resource usage
```bash
docker stats batch-report-app batch-report-db
```

### Alert khi API down (optional)
Setup uptime monitor: UptimeRobot, Healthchecks.io, hoặc script cron tự viết ping /api/health mỗi 5 phút và gửi email/Slack nếu fail.

## 9. Update code

```bash
cd /opt/batch-report-system

# Backup trước khi update
./scripts/backup-db.sh /var/backups/batch-reports

# Pull code mới (git) hoặc scp file mới

# Rebuild + restart
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# Verify
curl http://localhost:3000/api/health
```

## 10. Rollback nếu lỗi

```bash
# Restore DB từ backup gần nhất
./scripts/restore-db.sh /var/backups/batch-reports/batch_reports_20260101_020000.sql.gz

# Checkout git về commit cũ (nếu dùng git)
git checkout <previous-commit>

# Rebuild
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

## Production Checklist

Trước khi golive, verify từng mục:

- [ ] `NODE_ENV=production` trong .env
- [ ] `POSTGRES_PASSWORD` là password mạnh (không phải mặc định)
- [ ] `API_KEY` đã set và chia sẻ cho MES
- [ ] `CORS_ORIGINS` giới hạn đúng domain client
- [ ] `NAS_PASS` đúng service account
- [ ] `.env` có `chmod 600`
- [ ] Nginx setup với HTTPS + Let's Encrypt
- [ ] Firewall (ufw) enabled, chỉ mở 22/80/443
- [ ] Cron backup DB đã setup
- [ ] Đã test `curl http://localhost:3000/api/health` → 200 OK
- [ ] Đã test call API `/api/batches` từ MES với `x-api-key` → nhận data
- [ ] Đã test không có `x-api-key` → 401 Unauthorized
- [ ] Chia sẻ Swagger URL (https://batch-api.example.com/docs) cho team MES
- [ ] Setup monitoring/alert cho `/api/health`

## Troubleshooting

**CIFS mount fail:**
```bash
# Check cifs-utils
which mount.cifs

# Test mount thủ công
sudo mount -t cifs "//<NAS_IP>/<share>/Batch report" /mnt/test \
  -o "username=xxx,password=xxx,vers=3.0"
```

Nếu vẫn fail, thử `vers=2.0` hoặc `vers=1.0` trong `docker-compose.prod.yml`.

**Container app restart liên tục:**
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail 100 app
```

Thường do NAS_PASS sai, DB không kết nối được, hoặc port 3000 bị chiếm.

**Sync chạy chậm:**
Tăng `SYNC_CONCURRENCY` trong .env (VD: 15-20), restart app.
