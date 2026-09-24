import { BatchReportParser } from './base.parser';
import { ParsedBatchReport } from '../types/batch.types';
import { parseVnDateTime } from '../utils/date.util';

/**
 * Parser cho máy ép vỉ CP-250 (Blister Machine).
 * Báo cáo song ngữ Việt-Anh, layout đặc trưng:
 *   - Values ở đầu file (không có label kèm)
 *   - Labels ở phần dưới ("- Số lô / Batch number:")
 *
 * Batch number format: <số lô><A|B>. A/B là quy ước nội bộ FREMED
 * cho quy trình ép vỉ (mặt trước/mặt sau). Chỉ giữ phần số lô cho DB
 * để batch máy ép vỉ JOIN được với batch cùng số lô ở các máy khác.
 */
export class BlisterCP250Parser implements BatchReportParser {
  readonly machineType = 'Blister CP-250';

  canParse(pdfText: string): boolean {
    return (
      /BLISTER MACHINE/i.test(pdfText) ||
      /BÁO CÁO LÔ MÁY ÉP VỈ/i.test(pdfText)
    );
  }

  parse(pdfText: string): ParsedBatchReport {
    const modelMatch = pdfText.match(/BLISTER MACHINE\s+([A-Z0-9-]+)/i);
    const machineType = modelMatch ? `Blister ${modelMatch[1]}` : 'Blister Machine';

    const lines = pdfText.split('\n').map((l) => l.trim());

    const dtRegex = /^\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2}$/;
    let idx = -1;
    for (let i = 0; i < lines.length - 1; i++) {
      if (dtRegex.test(lines[i]) && dtRegex.test(lines[i + 1])) {
        idx = i;
        break;
      }
    }
    if (idx < 0) {
      throw new Error('Blister parser: cannot find start/end datetime pair');
    }

    const startTime = parseVnDateTime(lines[idx], 'dd/mm');
    const endTime = parseVnDateTime(lines[idx + 1], 'dd/mm');
    const batchSize = parseInt(lines[idx + 2], 10);
    const endProduct = parseInt(lines[idx + 3], 10);
    const rejectBlisters = parseInt(lines[idx + 4], 10);
    const gripStepComp = parseFloat(lines[idx + 5]);
    const recipeName = lines[idx + 6];
    const rawBatch = lines[idx + 7];
    const startUser = lines[idx + 8];
    const endUser = lines[idx + 9];

    const productName = recipeName.split(' - ')[0]?.trim();
    // Strip A/B suffix (quy ước nội bộ ép vỉ): 260158A → 260158
    const batchNumber = rawBatch.replace(/[AB]$/i, '');

    const machineIdMatch = pdfText.match(/CN\d{6,8}/);
    const machineId = machineIdMatch ? machineIdMatch[0] : 'CP-250';

    const durationSeconds = Math.round(
      (endTime.getTime() - startTime.getTime()) / 1000
    );

    return {
      batchNumber,
      productCode: productName,
      productName,
      machineId,
      machineType,
      processType: 'Blister Packaging',
      operator: startUser,
      startTime,
      endTime,
      durationSeconds,
      steps: [],
      metadata: {
        rawBatchNumber: rawBatch,
        blisterSide: /[AB]$/i.test(rawBatch) ? rawBatch.slice(-1).toUpperCase() : null,
        recipeName,
        batchSize,
        endProductBlisters: endProduct,
        rejectBlisters,
        gripStepCompensation: gripStepComp,
        startUser,
        endUser,
        yieldPercent:
          batchSize > 0 ? +((endProduct / batchSize) * 100).toFixed(2) : null,
      },
    };
  }
}
