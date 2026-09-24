import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Đường dẫn thư mục chứa file PDF report trên NAS/local
  REPORT_ROOT_DIR: z.string().min(1, 'REPORT_ROOT_DIR is required'),

  // Cron expression cho worker (mặc định mỗi 20 phút)
  SYNC_CRON: z.string().default('*/20 * * * *'),

  // Có chạy sync ngay lúc startup không
  SYNC_ON_STARTUP: z.coerce.boolean().default(false),

  // Số file parse SONG SONG cùng lúc (tăng tốc sync)
  // Giá trị lớn hơn = nhanh hơn nhưng tốn CPU/memory. Khuyến nghị: 5-10.
  SYNC_CONCURRENCY: z.coerce.number().min(1).max(50).default(5),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  // --- Security ---
  // Nếu set, API sẽ yêu cầu header "x-api-key: <value>"
  // Để rỗng = tắt authentication (dùng cho dev/internal LAN)
  API_KEY: z.string().optional(),

  // CORS: comma-separated origins, VD: "https://mes.fremed.com,https://app.fremed.com"
  // "*" = cho phép tất cả (chỉ dùng cho dev)
  CORS_ORIGINS: z.string().default('*'),

  // Rate limit: số request tối đa / IP trong khoảng thời gian
  RATE_LIMIT_MAX: z.coerce.number().default(300),
  RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().default(15),
});

export type AppConfig = z.infer<typeof configSchema>;

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:', parsed.error.format());
  process.exit(1);
}

export const config: AppConfig = parsed.data;

export const isProduction = config.NODE_ENV === 'production';
