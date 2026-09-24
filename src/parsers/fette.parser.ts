import { BatchReportParser } from './base.parser';
import { ParsedBatchReport } from '../types/batch.types';
import { parseVnDateTime } from '../utils/date.util';

/**
 * Parser cho máy dập viên Fette P2020.
 * Máy dập viên chạy liên tục, không có "step" như CMi.
 *
 * Thời gian chạy ưu tiên lấy từ log "Machine ON" → "Machine OFF".
 * Fallback: nếu không có ON/OFF (batch dừng giữa chừng), dùng min/max
 * timestamp từ tất cả events → không bỏ phí data.
 */
export class FetteP2020Parser implements BatchReportParser {
  readonly machineType = 'Fette P2020';

  canParse(pdfText: string): boolean {
    return /P2020\s+No\s+\d+/i.test(pdfText) && /FETTE|Change report/i.test(pdfText);
  }

  parse(pdfText: string): ParsedBatchReport {
    const header = this.parseHeader(pdfText);
    const productBatch = this.parseProductBatch(pdfText);
    const runWindow = this.extractMachineRunWindow(pdfText, header.reportDate);
    const producedTablets = this.extractProducedTablets(pdfText);

    return {
      batchNumber: productBatch.batchNumber,
      productCode: productBatch.productName,
      productName: productBatch.productName,
      machineId: header.machineId,
      machineType: this.machineType,
      processType: 'Tabletting',
      operator: header.operator,
      startTime: runWindow.startTime,
      endTime: runWindow.endTime,
      durationSeconds: Math.round(
        (runWindow.endTime.getTime() - runWindow.startTime.getTime()) / 1000
      ),
      steps: [],
      metadata: {
        producedTablets,
        machineModel: 'P2020',
        machineNumber: header.machineId,
        runWindowSource: runWindow.source, // 'ON_OFF' hoặc 'MIN_MAX_EVENTS'
      },
    };
  }

  private parseHeader(text: string): {
    machineId: string;
    reportDate: string;
    operator?: string;
  } {
    const m = text.match(
      /P2020\s+No\s+(\d+)\s+Date:\s+(\d{2}\.\d{2}\.\d{4})\s+\d{2}:\d{2}\s+Oper:\s+(\S+)/
    );
    if (!m) throw new Error('Fette parser: cannot parse header line');
    return { machineId: m[1], reportDate: m[2], operator: m[3] };
  }

  private parseProductBatch(text: string): {
    productName?: string;
    batchNumber: string;
  } {
    const productMatch = text.match(/Product:\s*(\S+)/);
    const batchMatch = text.match(/Batch:\s*(\S+)/);
    if (!batchMatch) throw new Error('Fette parser: cannot find batch number');
    return {
      productName: productMatch?.[1],
      batchNumber: batchMatch[1],
    };
  }

  /**
   * Ưu tiên Machine ON/OFF trong Change report.
   * Fallback: min/max timestamp trong Change report events.
   */
  private extractMachineRunWindow(
    text: string,
    reportDate: string
  ): { startTime: Date; endTime: Date; source: string } {
    const onMatch = text.match(/(\d{2}:\d{2}:\d{2})\s+Control\s+p:\s+Machine\s+ON/i);
    const offMatch = text.match(/(\d{2}:\d{2}:\d{2})\s+Control\s+p:\s+Machine\s+OFF/i);

    if (onMatch && offMatch) {
      const startTime = parseVnDateTime(`${reportDate} ${onMatch[1]}`, 'dd/mm');
      let endTime = parseVnDateTime(`${reportDate} ${offMatch[1]}`, 'dd/mm');
      if (endTime.getTime() < startTime.getTime()) {
        endTime = new Date(endTime.getTime() + 24 * 3600 * 1000);
      }
      return { startTime, endTime, source: 'ON_OFF' };
    }

    // FALLBACK: lấy tất cả timestamp trong file, dùng min/max
    const timestampRegex = /\b(\d{2}:\d{2}:\d{2})\b/g;
    const times: Date[] = [];
    let tm: RegExpExecArray | null;
    while ((tm = timestampRegex.exec(text)) !== null) {
      try {
        times.push(parseVnDateTime(`${reportDate} ${tm[1]}`, 'dd/mm'));
      } catch {
        /* skip */
      }
    }
    if (times.length < 2) {
      throw new Error(
        'Fette parser: cannot find Machine ON/OFF and no fallback timestamps'
      );
    }
    const startTime = new Date(Math.min(...times.map((d) => d.getTime())));
    const endTime = new Date(Math.max(...times.map((d) => d.getTime())));
    return { startTime, endTime, source: 'MIN_MAX_EVENTS' };
  }

  private extractProducedTablets(text: string): number | undefined {
    const m = text.match(/Produced tablets\s+(\d+)/);
    return m ? parseInt(m[1], 10) : undefined;
  }
}
