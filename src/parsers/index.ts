import fs from 'fs/promises';
import pdfParse from 'pdf-parse';
import { BatchReportParser } from './base.parser';
import { GeaBatchReportParser } from './gea.parser';
import { FetteP2020Parser } from './fette.parser';
import { BlisterCP250Parser } from './blister.parser';
import { ParsedBatchReport } from '../types/batch.types';
import { logger } from '../utils/logger';

/**
 * Error đặc biệt khi file không phải batch report (VD: parameter list, hardcopy).
 * Sync service catch riêng, đánh dấu status='ignored' thay vì 'error'.
 */
export class NotABatchReportError extends Error {
  constructor(fileName: string) {
    super(`Not a batch report: ${fileName}`);
    this.name = 'NotABatchReportError';
  }
}

/**
 * Danh sách parser đã cài đặt.
 * Máy GEA cùng format (CMi 400, CMi 1200, HSG PRO 200, GFB PRO 30, ...) dùng
 * chung GeaBatchReportParser — thêm máy GEA mới KHÔNG cần sửa code.
 * Máy vendor khác cần parser riêng.
 */
const parsers: BatchReportParser[] = [
  new GeaBatchReportParser(),
  new FetteP2020Parser(),
  new BlisterCP250Parser(),
];

/**
 * Đọc file PDF từ đĩa và trả về ParsedBatchReport.
 * Auto-detect loại máy dựa vào nội dung file.
 * Nếu không parser nào nhận diện → throw NotABatchReportError.
 */
export async function parsePdfFile(filePath: string): Promise<ParsedBatchReport> {
  const buffer = await fs.readFile(filePath);
  const pdfData = await pdfParse(buffer);
  const text = pdfData.text;

  const parser = parsers.find((p) => p.canParse(text));
  if (!parser) {
    throw new NotABatchReportError(filePath);
  }

  logger.debug(`Using ${parser.machineType} parser for ${filePath}`);
  return parser.parse(text);
}

export { parsers };
