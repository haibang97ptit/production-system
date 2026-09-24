import { Request, Response, NextFunction } from 'express';
import { getMachineSummary, listMachines } from '../../repositories/machine.repository';

export async function getMachines(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    res.json(await listMachines());
  } catch (e) {
    next(e);
  }
}

export async function getMachineSummaryHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { machineId } = req.params as { machineId: string };
    const from = req.query.from ? new Date(req.query.from as string) : undefined;
    const to = req.query.to ? new Date(req.query.to as string) : undefined;

    const result = await getMachineSummary({ machineId, from, to });
    res.json(result);
  } catch (e) {
    next(e);
  }
}
