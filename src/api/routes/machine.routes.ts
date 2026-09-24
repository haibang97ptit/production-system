import { Router } from 'express';
import {
  getMachines,
  getMachineSummaryHandler,
} from '../controllers/machine.controller';

const router = Router();

/**
 * @openapi
 * /api/machines:
 *   get:
 *     tags: [Machines]
 *     summary: Danh sách tất cả máy đã ghi nhận
 *     responses:
 *       200:
 *         description: Danh sách máy với tổng số run và thời gian first/last seen
 */
router.get('/', getMachines);

/**
 * @openapi
 * /api/machines/{machineId}/summary:
 *   get:
 *     tags: [Machines]
 *     summary: Tổng hợp hiệu suất 1 máy trong khoảng thời gian
 *     parameters:
 *       - in: path
 *         name: machineId
 *         required: true
 *         schema: { type: string }
 *         example: CN018153
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Tổng hợp gồm tổng số batch, tổng thời gian chạy, chi tiết từng run
 */
router.get('/:machineId/summary', getMachineSummaryHandler);

export default router;
