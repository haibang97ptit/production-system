/**
 * Cấu trúc dữ liệu chuẩn mà mọi parser phải trả về
 * Bảo đảm dữ liệu đầu ra đồng nhất dù input đến từ máy loại nào
 */
export interface ParsedBatchReport {
  batchNumber: string;
  productCode?: string;
  productName?: string;

  machineId: string;
  machineType: string;         // VD: "CMi 400", "P2020"
  processType?: string;         // VD: "Container Blending", "Tabletting"

  operator?: string;
  startTime: Date;
  endTime: Date;
  durationSeconds: number;

  steps: ParsedStep[];          // Rỗng nếu máy không có khái niệm step (như Fette)
  metadata?: Record<string, unknown>;  // Dữ liệu đặc thù từng máy (VD: producedTablets)
}

export interface ParsedStep {
  stepCounter: number;
  stepName: string;
  startTime: Date;
  endTime: Date;
  durationSeconds: number;
  dataPoints?: number;
}
