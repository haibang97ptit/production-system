import cron from 'node-cron';
import { config } from '../config';
import { logger } from '../utils/logger';
import { syncReports } from '../services/sync.service';

let running = false;

export function startSyncWorker(): void {
  if (!cron.validate(config.SYNC_CRON)) {
    logger.error(`Invalid SYNC_CRON expression: "${config.SYNC_CRON}"`);
    return;
  }

  logger.info(`Sync worker scheduled with cron: "${config.SYNC_CRON}"`);
  cron.schedule(config.SYNC_CRON, runSyncSafely);

  if (config.SYNC_ON_STARTUP) {
    logger.info('SYNC_ON_STARTUP=true → running initial sync');
    void runSyncSafely();
  }
}

async function runSyncSafely(): Promise<void> {
  if (running) {
    logger.warn('Previous sync still running, skipping this tick');
    return;
  }
  running = true;
  try {
    await syncReports();
  } catch (e) {
    logger.error('Sync worker error:', e);
  } finally {
    running = false;
  }
}
