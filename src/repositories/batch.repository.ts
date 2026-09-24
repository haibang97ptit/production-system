import { prisma } from '../db/prisma';
import { ParsedBatchReport } from '../types/batch.types';

/**
 * Upsert 1 batch report vào DB.
 * Nếu batch chưa tồn tại → tạo mới.
 * Nếu machine run (theo unique key machineId + batchNumber + startTime) chưa có → thêm.
 * Nếu đã có → cập nhật.
 */
export async function upsertBatchReport(
  data: ParsedBatchReport,
  sourceFile: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Đảm bảo batch tồn tại
    await tx.batch.upsert({
      where: { batchNumber: data.batchNumber },
      create: {
        batchNumber: data.batchNumber,
        productCode: data.productCode,
        productName: data.productName,
      },
      update: {
        // Cập nhật productCode/name nếu có (khi máy đầu tiên chưa có, máy sau có)
        ...(data.productCode ? { productCode: data.productCode } : {}),
        ...(data.productName ? { productName: data.productName } : {}),
      },
    });

    // Upsert machine run
    const existingRun = await tx.machineRun.findUnique({
      where: {
        machineId_batchNumber_startTime: {
          machineId: data.machineId,
          batchNumber: data.batchNumber,
          startTime: data.startTime,
        },
      },
    });

    const runId = existingRun
      ? existingRun.id
      : (
          await tx.machineRun.create({
            data: {
              batchNumber: data.batchNumber,
              machineId: data.machineId,
              machineType: data.machineType,
              processType: data.processType,
              operator: data.operator,
              startTime: data.startTime,
              endTime: data.endTime,
              durationSeconds: data.durationSeconds,
              sourceFile,
              metadata: data.metadata as object | undefined,
            },
          })
        ).id;

    // Xoá và tạo lại steps (đơn giản, không cần diff)
    if (data.steps.length > 0) {
      await tx.step.deleteMany({ where: { machineRunId: runId } });
      await tx.step.createMany({
        data: data.steps.map((s) => ({
          machineRunId: runId,
          stepCounter: s.stepCounter,
          stepName: s.stepName,
          startTime: s.startTime,
          endTime: s.endTime,
          durationSeconds: s.durationSeconds,
          dataPoints: s.dataPoints,
        })),
      });
    }

    // Cập nhật lại overall time trên batch (dựa vào tất cả machine runs của batch đó)
    const runs = await tx.machineRun.findMany({
      where: { batchNumber: data.batchNumber },
      select: { startTime: true, endTime: true },
    });
    const overallStart = new Date(Math.min(...runs.map((r) => r.startTime.getTime())));
    const overallEnd = new Date(Math.max(...runs.map((r) => r.endTime.getTime())));
    await tx.batch.update({
      where: { batchNumber: data.batchNumber },
      data: {
        overallStartTime: overallStart,
        overallEndTime: overallEnd,
        totalDurationSeconds: Math.round(
          (overallEnd.getTime() - overallStart.getTime()) / 1000
        ),
      },
    });
  });
}

export async function findBatchByNumber(batchNumber: string) {
  return prisma.batch.findUnique({
    where: { batchNumber },
    include: {
      machineRuns: {
        include: { steps: { orderBy: { stepCounter: 'asc' } } },
        orderBy: { startTime: 'asc' },
      },
    },
  });
}

export async function listBatches(params: {
  from?: Date;
  to?: Date;
  productCode?: string;
  limit?: number;
  offset?: number;
}) {
  const { from, to, productCode, limit = 50, offset = 0 } = params;

  const where: any = {};
  if (from || to) {
    where.overallStartTime = {};
    if (from) where.overallStartTime.gte = from;
    if (to) where.overallStartTime.lte = to;
  }
  if (productCode) where.productCode = productCode;

  const [items, total] = await Promise.all([
    prisma.batch.findMany({
      where,
      include: { machineRuns: { select: { machineId: true, machineType: true } } },
      orderBy: { overallStartTime: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.batch.count({ where }),
  ]);

  return { items, total, limit, offset };
}
