# Batch Report System

API + Worker đọc file PDF report của các máy sản xuất và cung cấp REST API cho phần mềm quản lý sản xuất (MES).

## Kiến trúc

```
Máy sản xuất → PDF report → NAS/local folder
                                  │
                                  ▼
                  Worker (cron mỗi 20p) → PostgreSQL
                                  │
                                  ▼
                  REST API (Express + Swagger) → Phần mềm QLSX/MES
```

## Máy hỗ trợ

| Vendor | Máy | Parser |
|---|---|---|
| GEA | CMi 400, CMi 1200, HSG PRO 200, GFB PRO 30, và mọi máy khác cùng format | GeaBatchReportParser (generic) |
| Fette | P2020 | FetteP2020Parser |
| FREMED | Blister CP-250 | BlisterCP250Parser |

**Thêm máy GEA mới cùng format = KHÔNG cần sửa code**, chỉ cần copy file PDF vào folder NAS.

## Tech stack

- Node.js 20 + TypeScript (strict mode)
- Express.js
- PostgreSQL 16 + Prisma ORM
- node-cron (worker)
- pdf-parse (PDF parser)
- Swagger UI (API docs)
- Winston (logging)
- Docker + Docker Compose

## Cấu trúc source

```
src/
├── config/          # Load & validate env
├── types/           # TypeScript types dùng chung
├── parsers/         # Parser cho từng loại máy
│   ├── base.parser.ts       # Interface chung
│   ├── gea.parser.ts        # Generic cho tất cả máy GEA
│   ├── fette.parser.ts      # Fette P2020
│   ├── blister.parser.ts    # Blister CP-250
│   └── index.ts             # Auto-detect & dispatch
├── db/              # Prisma client
├── repositories/    # Query DB (batch, machine)
├── services/        # Business logic (sync)
├── workers/         # Cron jobs
├── api/             # Express controllers, routes, middlewares, swagger
├── utils/           # Logger, date helpers
├── app.ts           # Express app setup
└── server.ts        # Entry point
```

---

## Setup Dev (Windows local)

Xem chi tiết trong PRODUCTION.md cho Ubuntu server.

### Yêu cầu
Docker Desktop for Windows

### Các bước

**1. Chuẩn bị file PDF**

Có 2 cách:
- **Cách A:** Copy file vào folder local (VD: `C:\BatchReports\`)
- **Cách B:** Mount CIFS trực tiếp từ NAS (khuyến nghị)

**2. Tạo `.env`**

```
copy .env.example .env
```

Sửa:
- Cách A: `REPORT_HOST_DIR=C:\BatchReports`
- Cách B: điền các biến `NAS_HOST`, `NAS_SHARE`, `NAS_USER`, `NAS_PASS`

**3. Build & chạy**

Cách A (folder local):
```
docker compose -f docker-compose.yml -f docker-compose.dev-nas.yml up --build
```

*Lưu ý: file `docker-compose.dev-nas.yml` mount CIFS trực tiếp, hoạt động cho cả 2 cách.*

**4. Kiểm tra**

- Swagger UI: http://localhost:3000/docs
- Health: http://localhost:3000/api/health

---

## Deploy Production (Ubuntu)

Xem **[PRODUCTION.md](PRODUCTION.md)** — hướng dẫn đầy đủ với security checklist.

Tóm tắt:
```bash
# 1. Cài Docker + cifs-utils
sudo apt install docker.io docker-compose-plugin cifs-utils

# 2. Copy source, cấu hình .env (đổi POSTGRES_PASSWORD, API_KEY, CORS_ORIGINS, NAS_*)
cp .env.example .env && nano .env && chmod 600 .env

# 3. Build & chạy
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# 4. Verify
curl http://localhost:3000/api/health
```

---

## API endpoints

Full docs tại `/docs` (Swagger).

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/health` | Health check + DB stats + sync status |
| GET | `/api/batches` | Danh sách batch (filter from/to/productCode) |
| GET | `/api/batches/:batchNumber` | Chi tiết 1 batch |
| GET | `/api/machines` | Danh sách máy đã ghi nhận |
| GET | `/api/machines/:machineId/summary` | Tổng hợp hiệu suất máy |

### Authentication

Nếu `.env` có `API_KEY=xxx`, mọi request `/api/batches`, `/api/machines` phải kèm header:
```
x-api-key: xxx
```

`/api/health` và `/docs` luôn public.

### Rate limit

Mặc định 300 requests / 15 phút / IP. Sửa qua `RATE_LIMIT_MAX` và `RATE_LIMIT_WINDOW_MINUTES` trong `.env`.

### Ví dụ response `/api/batches/EN2603501`

```json
{
  "batchNumber": "EN2603501",
  "productCode": "EN2603501",
  "productName": "MIDITEL 80",
  "overallStartTime": "2026-08-21T17:52:08.000Z",
  "overallEndTime":   "2026-08-21T18:01:21.000Z",
  "totalDurationSeconds": 553,
  "machineRuns": [
    {
      "machineId": "CN018153",
      "machineType": "CMi 400",
      "processType": "Container Blending",
      "operator": "Dang Phat Vinh",
      "startTime": "2026-08-21T17:52:08.000Z",
      "endTime":   "2026-08-21T18:01:21.000Z",
      "durationSeconds": 553,
      "steps": [
        { "stepCounter": 1, "stepName": "Nang bon tron", "durationSeconds": 49 },
        { "stepCounter": 2, "stepName": "Tron so bo",    "durationSeconds": 483 },
        { "stepCounter": 3, "stepName": "Ha bon tron",   "durationSeconds": 21 }
      ]
    }
  ]
}
```

---

## Vận hành

### Xem log
```bash
docker compose logs -f app
```

### Restart app (không đụng DB)
```bash
docker compose restart app
```

### Trigger sync ngay (không đợi cron)
Set tạm `SYNC_ON_STARTUP=true` trong .env → `docker compose restart app`.

### Backup DB
```bash
./scripts/backup-db.sh /var/backups/batch-reports
```

### Restore DB
```bash
./scripts/restore-db.sh /var/backups/batch-reports/batch_reports_20260101_020000.sql.gz
```

### Xem/sửa DB bằng GUI (Prisma Studio)
```bash
docker compose exec app npx prisma studio
# → mở http://localhost:5555
```

---

## Thêm máy mới

### Nếu là máy GEA cùng format hiện tại
Không cần làm gì. Copy file PDF vào folder NAS, worker tự nhận.

### Nếu là máy VENDOR KHÁC

1. Tạo `src/parsers/<vendor>.parser.ts`, implement `BatchReportParser`:
   ```ts
   export class VendorXParser implements BatchReportParser {
     readonly machineType = 'Vendor X';
     canParse(text: string) { return /keyword/i.test(text); }
     parse(text: string): ParsedBatchReport { ... }
   }
   ```

2. Đăng ký trong `src/parsers/index.ts`:
   ```ts
   const parsers: BatchReportParser[] = [
     new GeaBatchReportParser(),
     new FetteP2020Parser(),
     new BlisterCP250Parser(),
     new VendorXParser(),   // ← thêm
   ];
   ```

3. Rebuild:
   ```
   docker compose up -d --build
   ```

---

## Ghi chú

- Parser dựa vào **cấu trúc PDF cố định**. Nếu vendor nâng cấp phần mềm và đổi layout, cần chỉnh parser — nên lưu vài file mẫu cũ để regression test.
- File đã parse thành công **không parse lại** (theo dõi qua `parsed_files` + so sánh file size). Muốn parse lại: `DELETE FROM parsed_files WHERE file_name = '...';`
- Worker skip lần chạy tiếp theo nếu lần trước còn đang chạy → tránh chồng chéo.
- Sync xử lý SONG SONG theo `SYNC_CONCURRENCY` (mặc định 5) — tăng số này nếu server mạnh, giảm nếu OOM.
