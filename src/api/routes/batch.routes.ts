import { Router } from 'express';
import { getBatch, getBatches } from '../controllers/batch.controller';

const router = Router();

/**
 * @openapi
 * /api/batches:
 *   get:
 *     tags: [Batches]
 *     summary: Danh sách các batch trong khoảng thời gian
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *         description: "ISO datetime, VD: 2026-08-01T00:00:00Z"
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: productCode
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *     responses:
 *       200:
 *         description: Danh sách batch, kèm tổng số record
 */
router.get('/', getBatches);

/**
 * @openapi
 * /api/batches/{batchNumber}:
 *   get:
 *     tags: [Batches]
 *     summary: Chi tiết 1 batch, gồm toàn bộ machine runs và steps
 *     parameters:
 *       - in: path
 *         name: batchNumber
 *         required: true
 *         schema: { type: string }
 *         example: EN2603501
 *     responses:
 *       200:
 *         description: Chi tiết batch
 *       404:
 *         description: Không tìm thấy batch
 */
router.get('/:batchNumber', getBatch);

export default router;
