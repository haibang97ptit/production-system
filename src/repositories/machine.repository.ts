import { prisma } from '../db/prisma';

export async function getMachineSummary(params: {
  machineId: string;
  from?: Date;
  to?: Date;
}) {
  const { machineId, from, to } = params;

  const where: any = { machineId };
  if (from || to) {
    where.startTime = {};
    if (from) where.startTime.gte = from;
    if (to) where.startTime.lte = to;
  }

  const runs = await prisma.machineRun.findMany({
    where,
    orderBy: { startTime: 'asc' },
    include: { steps: { orderBy: { stepCounter: 'asc' } } },
  });

  const totalRuns = runs.length;
  const totalRunSeconds = runs.reduce((s, r) => s + r.durationSeconds, 0);

  // Machine type: lấy từ run đầu tiên (thường không đổi)
  const machineType = runs[0]?.machineType ?? null;

  return {
    machineId,
    machineType,
    period: { from: from ?? null, to: to ?? null },
    totalBatches: totalRuns,
    totalRunSeconds,
    totalRunHours: +(totalRunSeconds / 3600).toFixed(2),
    runs: runs.map((r) => ({
      batchNumber: r.batchNumber,
      startTime: r.startTime,
      endTime: r.endTime,
      durationSeconds: r.durationSeconds,
      operator: r.operator,
      metadata: r.metadata,
      steps: r.steps.map((s) => ({
        stepCounter: s.stepCounter,
        stepName: s.stepName,
        durationSeconds: s.durationSeconds,
      })),
    })),
  };
}

export async function listMachines() {
  const machines = await prisma.machineRun.groupBy({
    by: ['machineId', 'machineType'],
    _count: { _all: true },
    _min: { startTime: true },
    _max: { endTime: true },
  });
  return machines.map((m) => ({
    machineId: m.machineId,
    machineType: m.machineType,
    totalRuns: m._count._all,
    firstSeen: m._min.startTime,
    lastSeen: m._max.endTime,
  }));
}
