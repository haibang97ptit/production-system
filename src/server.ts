import { config } from './config';
import { logger } from './utils/logger';
import { createApp } from './app';
import { startSyncWorker } from './workers/sync.worker';
import { prisma } from './db/prisma';
import type { Server } from 'http';

async function main(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info('Database connection OK');
  } catch (e) {
    logger.error('Cannot connect to database:', e);
    process.exit(1);
  }

  const app = createApp();
  const server: Server = app.listen(config.PORT, () => {
    logger.info(`API listening on port ${config.PORT}`);
    logger.info(`Environment: ${config.NODE_ENV}`);
    logger.info(`Swagger UI: http://localhost:${config.PORT}/docs`);
    if (config.API_KEY) {
      logger.info('API key authentication: ENABLED');
    } else {
      logger.warn('API key authentication: DISABLED (set API_KEY in .env to enable)');
    }
  });

  // Timeouts phù hợp với hệ thống nội bộ (nginx/proxy defaults)
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  startSyncWorker();

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down gracefully...`);

    // Ngừng nhận request mới
    server.close(() => logger.info('HTTP server closed'));

    // Đợi request đang xử lý xong (max 15s)
    const timeoutMs = 15000;
    const forceTimer = setTimeout(() => {
      logger.warn(`Shutdown timeout ${timeoutMs}ms exceeded, forcing exit`);
      process.exit(1);
    }, timeoutMs);
    forceTimer.unref();

    try {
      await prisma.$disconnect();
      logger.info('Database disconnected');
    } catch (e) {
      logger.error('Error during Prisma disconnect:', e);
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Log unhandled errors thay vì crash im lặng
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection:', reason);
  });
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception:', err);
    void shutdown('uncaughtException');
  });
}

void main();
