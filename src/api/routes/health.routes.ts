import { Router } from 'express';
import { prisma } from '../../db/prisma';
import { getLastSyncInfo } from '../../services/sync.service';
import { config } from '../../config';

const router = Router();
const startedAt = new Date();

/**
 * @openapi
 * /api/health:
 *   get:
 *     tags: [System]
 *     summary: Kiểm tra hệ thống hoạt động (DB, worker sync)
 *     responses:
 *       200:
 *         description: OK
 *       503:
 *         description: DB không kết nối được
 */
router.get('/', async (_req, res) => {
  const uptimeSeconds = Math.floor((Date.now() - startedAt.getTime()) / 1000);
  const lastSync = getLastSyncInfo();

  try {
    await prisma.$queryRaw`SELECT 1`;

    const [batchCount, machineRunCount, parsedFileCount] = await Promise.all([
      prisma.batch.count(),
      prisma.machineRun.count(),
      prisma.parsedFile.count(),
    ]);

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime_seconds: uptimeSeconds,
      environment: config.NODE_ENV,
      db: {
        connected: true,
        batches: batchCount,
        machine_runs: machineRunCount,
        parsed_files: parsedFileCount,
      },
      sync: {
        cron: config.SYNC_CRON,
        concurrency: config.SYNC_CONCURRENCY,
        last_run_at: lastSync.at?.toISOString() ?? null,
        last_stats: lastSync.stats,
      },
    });
  } catch (e) {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      uptime_seconds: uptimeSeconds,
      db: { connected: false },
      error: (e as Error).message,
    });
  }
});

export default router;
