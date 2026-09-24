import { Request, Response, NextFunction } from 'express';
import { findBatchByNumber, listBatches } from '../../repositories/batch.repository';

export async function getBatch(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { batchNumber } = req.params as { batchNumber: string };
    const batch = await findBatchByNumber(batchNumber);
    if (!batch) {
      res.status(404).json({ error: { message: `Batch ${batchNumber} not found` } });
      return;
    }
    res.json(batch);
  } catch (e) {
    next(e);
  }
}

export async function getBatches(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const from = req.query.from ? new Date(req.query.from as string) : undefined;
    const to = req.query.to ? new Date(req.query.to as string) : undefined;
    const productCode = req.query.productCode as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

    const result = await listBatches({ from, to, productCode, limit, offset });
    res.json(result);
  } catch (e) {
    next(e);
  }
}
