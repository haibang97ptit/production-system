import { ParsedBatchReport } from '../types/batch.types';

/**
 * Mọi parser cụ thể (CMi 400, Fette, v.v.) đều implement interface này.
 * Nhờ vậy hệ thống có thể auto-detect và gọi parser phù hợp mà không
 * cần biết chi tiết bên trong.
 */
export interface BatchReportParser {
  /** Tên định danh loại máy (dùng cho log/debug) */
  readonly machineType: string;

  /**
   * Xem text đã trích xuất từ PDF có đúng định dạng của máy này không.
   * Trả true nếu parser này có thể xử lý.
   */
  canParse(pdfText: string): boolean;

  /** Trích xuất dữ liệu batch từ text */
  parse(pdfText: string): ParsedBatchReport;
}
