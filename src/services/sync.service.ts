import fs from 'fs/promises';
import path from 'path';
import { config } from '../config';
import { logger } from '../utils/logger';
import { prisma } from '../db/prisma';
import { parsePdfFile, NotABatchReportError } from '../parsers';
import { upsertBatchReport } from '../repositories/batch.repository';

interface SyncStats {
  scanned: number;
  parsed: number;
  skipped: number;
  ignored: number;
  errors: number;
  durationMs: number;
}

let lastSyncStats: SyncStats | null = null;
let lastSyncAt: Date | null = null;

export function getLastSyncInfo(): {
  stats: SyncStats | null;
  at: Date | null;
} {
  return { stats: lastSyncStats, at: lastSyncAt };
}

/**
 * Quét toàn bộ file .pdf trong REPORT_ROOT_DIR (đệ quy), parse SONG SONG
 * theo batch size = SYNC_CONCURRENCY, ghi vào DB.
 *
 * Kết quả xử lý mỗi file:
 *  - parsed: parse thành công, lưu DB
 *  - skipped: đã parse trước, size không đổi
 *  - ignored: không phải batch report → đánh dấu, không xử lý lại
 *  - error: parse thất bại thật sự
 */
export async function syncReports(): Promise<SyncStats> {
  const startedAt = Date.now();
  const stats: SyncStats = {
    scanned: 0,
    parsed: 0,
    skipped: 0,
    ignored: 0,
    errors: 0,
    durationMs: 0,
  };

  logger.info(`Starting sync from ${config.REPORT_ROOT_DIR}`);

  let pdfFiles: string[];
  try {
    pdfFiles = await findPdfFiles(config.REPORT_ROOT_DIR);
  } catch (e) {
    logger.error(`Cannot read report directory: ${(e as Error).message}`);
    stats.durationMs = Date.now() - startedAt;
    lastSyncStats = stats;
    lastSyncAt = new Date();
    return stats;
  }

  stats.scanned = pdfFiles.length;
  logger.info(
    `Found ${pdfFiles.length} PDF file(s), processing ${config.SYNC_CONCURRENCY} in parallel`
  );

  // Load list file đã xử lý để skip
  const alreadyProcessed = new Map<string, { size: number; status: string }>(
    (
      await prisma.parsedFile.findMany({
        where: { status: { in: ['success', 'ignored'] } },
      })
    ).map((p) => [p.fileName, { size: p.fileSize, status: p.status }])
  );

  // Chia files thành các batch để parse song song
  const concurrency = config.SYNC_CONCURRENCY;
  for (let i = 0; i < pdfFiles.length; i += concurrency) {
    const batch = pdfFiles.slice(i, i + concurrency);
    await Promise.all(batch.map((f) => processFile(f, alreadyProcessed, stats)));
  }

  stats.durationMs = Date.now() - startedAt;
  lastSyncStats = stats;
  lastSyncAt = new Date();
  logger.info(
    `Sync done: scanned=${stats.scanned} parsed=${stats.parsed} skipped=${stats.skipped} ignored=${stats.ignored} errors=${stats.errors} (${stats.durationMs}ms)`
  );
  return stats;
}

async function processFile(
  filePath: string,
  alreadyProcessed: Map<string, { size: number; status: string }>,
  stats: SyncStats
): Promise<void> {
  const fileName = path.basename(filePath);
  try {
    const stat = await fs.stat(filePath);
    const prev = alreadyProcessed.get(fileName);

    if (prev !== undefined && prev.size === stat.size) {
      stats.skipped++;
      return;
    }

    const parsed = await parsePdfFile(filePath);
    await upsertBatchReport(parsed, fileName);

    await prisma.parsedFile.upsert({
      where: { fileName },
      create: { fileName, fileSize: stat.size, status: 'success' },
      update: {
        fileSize: stat.size,
        status: 'success',
        errorMsg: null,
        parsedAt: new Date(),
      },
    });

    stats.parsed++;
    logger.info(
      `Parsed ${fileName} → batch=${parsed.batchNumber}, machine=${parsed.machineId} (${parsed.machineType})`
    );
  } catch (e) {
    const err = e as Error;
    const stat = await fs.stat(filePath).catch(() => null);

    if (err instanceof NotABatchReportError) {
      stats.ignored++;
      logger.debug(`Ignored non-batch-report file: ${fileName}`);
      try {
        await prisma.parsedFile.upsert({
          where: { fileName },
          create: { fileName, fileSize: stat?.size ?? 0, status: 'ignored' },
          update: {
            fileSize: stat?.size ?? 0,
            status: 'ignored',
            errorMsg: null,
            parsedAt: new Date(),
          },
        });
      } catch {}
      return;
    }

    stats.errors++;
    logger.error(`Failed to parse ${fileName}: ${err.message}`);
    try {
      await prisma.parsedFile.upsert({
        where: { fileName },
        create: {
          fileName,
          fileSize: stat?.size ?? 0,
          status: 'error',
          errorMsg: err.message,
        },
        update: { status: 'error', errorMsg: err.message, parsedAt: new Date() },
      });
    } catch {}
  }
}

async function findPdfFiles(dir: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findPdfFiles(full);
      result.push(...nested);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
      result.push(full);
    }
  }
  return result;
}
