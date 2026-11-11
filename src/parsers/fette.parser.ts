import { BatchReportParser } from './base.parser';
import { ParsedBatchReport } from '../types/batch.types';
import { parseVnDateTime, detectDateFormat, DateFormat } from '../utils/date.util';

/**
 * Parser cho máy dập viên Fette (P1010, P2020, ... — mọi model cùng format báo cáo).
 * Máy dập viên chạy liên tục, không có "step" như CMi.
 *
 * Cấu trúc file (mỗi trang đều lặp lại header):
 *   P1010 No 39051  Date: 14.02.2025 13:57  Oper: kimda.nguyen
 *   Product: FRECLOVIR 400 - R.TB0029 - V01
 *   Batch: 250018
 *
 * Thời gian chạy:
 *  1. Ưu tiên: Change report — Machine ON sớm nhất → Machine OFF muộn nhất.
 *     Change report xếp mới → cũ, mỗi ngày có 1 dòng ngày riêng ("14.02.2025")
 *     → mỗi sự kiện được gắn đúng ngày của nó (batch chạy qua nhiều ngày).
 *  2. Fallback: thời điểm các mẫu đo trong Production report (min → max).
 *
 * File không có cả 2 nguồn trên (VD: chỉ export Diagnosis report, Batch list)
 * → canParse = false → hệ thống đánh dấu "ignored", không tạo dữ liệu giả.
 */

const HEADER_RE =
  /(P\d{4})\s+No\s+(\d+)\s+Date:\s+(\d{1,2}[./]\d{1,2}[./]\d{4})\s+\d{1,2}:\d{2}\s+Oper:\s+(\S+)/;
const DATE_LINE_RE = /^\s*(\d{1,2}[./]\d{1,2}[./]\d{4})\s*$/;
const MACHINE_EVENT_RE = /^\s*(\d{2}:\d{2}:\d{2})\s+Control\s+.*?Machine\s+(ON|OFF)\s*$/;
// Mẫu đo Production report: "08:59:09    P         2   18,0 ..." (text PDF hay bị dính liền,
// VD "14.02.202508:58:03" hoặc "3,408:59:09" — regex vẫn tách đúng giờ).
const PRODUCTION_TOKEN_RE =
  /(\d{1,2}[./]\d{1,2}[./]\d{4})|(\d{2}:\d{2}:\d{2})(?=\s+[A-Z]\s+\d+\s+\d)/g;

interface MachineEvent {
  time: Date;
  type: 'ON' | 'OFF';
}

export class FetteParser implements BatchReportParser {
  readonly machineType = 'Fette';

  /**
   * Dùng chung logic đọc với parse(): chỉ nhận file khi THỰC SỰ đọc được Machine ON/OFF
   * hoặc mẫu đo trong đúng mục Change report / Production report.
   * (Dòng Diagnosis report như "11:08:35  S  1  5106 ..." trông giống mẫu đo → không được tính.)
   */
  canParse(pdfText: string): boolean {
    if (!HEADER_RE.test(pdfText) || !/Batch:[ \t]*\S/.test(pdfText)) return false;
    try {
      const { events, samples } = this.extractTimeline(pdfText);
      return events.length > 0 || samples.length > 0;
    } catch {
      return false;
    }
  }

  parse(pdfText: string): ParsedBatchReport {
    const header = this.parseHeader(pdfText);
    const productBatch = this.parseProductBatch(pdfText);
    const { events, samples } = this.extractTimeline(pdfText);
    const runWindow = this.computeRunWindow(events, samples);

    return {
      batchNumber: productBatch.batchNumber,
      // Không set productCode: tránh ghi đè mã sản phẩm chính thức lấy từ report GEA
      productName: productBatch.productName,
      machineId: header.machineId,
      machineType: `Fette ${header.model}`,
      processType: 'Tabletting',
      operator: header.operator,
      startTime: runWindow.startTime,
      endTime: runWindow.endTime,
      durationSeconds: Math.round(
        (runWindow.endTime.getTime() - runWindow.startTime.getTime()) / 1000
      ),
      steps: [],
      metadata: {
        producedTablets: this.extractProducedTablets(pdfText),
        machineModel: header.model,
        machineNumber: header.machineId,
        runWindowSource: runWindow.source, // 'ON_OFF' | 'ON_LAST_EVENT' | 'PRODUCTION_SAMPLES'
        machineOnCount: events.filter((e) => e.type === 'ON').length,
        productionSamples: samples.length,
      },
    };
  }

  private extractTimeline(text: string): { events: MachineEvent[]; samples: Date[] } {
    const dateFormat = detectDateFormat(text);
    const { reportDate } = this.parseHeader(text);
    const pages = text.split(/page:\s*\d+\s*\/\s*\d+/);
    return {
      events: this.extractMachineEvents(pages, reportDate, dateFormat),
      samples: this.extractProductionSamples(pages, reportDate, dateFormat),
    };
  }

  private parseHeader(text: string): {
    model: string;
    machineId: string;
    reportDate: string;
    operator?: string;
  } {
    const m = text.match(HEADER_RE);
    if (!m) throw new Error('Fette parser: cannot parse header line');
    return { model: m[1], machineId: m[2], reportDate: m[3], operator: m[4] };
  }

  private parseProductBatch(text: string): {
    productName?: string;
    batchNumber: string;
  } {
    const productMatch = text.match(/Product:[ \t]*([^\n]*?)[ \t]*$/m);
    const batchMatch = text.match(/Batch:[ \t]*(\S+)/);
    if (!batchMatch) throw new Error('Fette parser: cannot find batch number');
    return {
      productName: productMatch?.[1] || undefined,
      batchNumber: batchMatch[1],
    };
  }

  /** Nội dung trang sau dòng "Batch: ..." (bỏ header lặp lại ở mỗi trang) */
  private pageBody(page: string): string {
    const idx = page.indexOf('Batch:');
    if (idx < 0) return '';
    const nl = page.indexOf('\n', idx);
    return nl < 0 ? '' : page.slice(nl + 1);
  }

  private extractMachineEvents(
    pages: string[],
    reportDate: string,
    fmt: DateFormat
  ): MachineEvent[] {
    const events: MachineEvent[] = [];
    let currentDate = reportDate;
    for (const page of pages) {
      // Dòng tiêu đề "Change report" (dòng mục lục có dấu "....." nên không khớp)
      if (!/^\s*Change report(?!\.)/m.test(page)) continue;
      for (const line of this.pageBody(page).split('\n')) {
        const d = line.match(DATE_LINE_RE);
        if (d) {
          currentDate = d[1];
          continue;
        }
        const e = line.match(MACHINE_EVENT_RE);
        if (e) {
          events.push({
            time: parseVnDateTime(`${currentDate} ${e[1]}`, fmt),
            type: e[2] as 'ON' | 'OFF',
          });
        }
      }
    }
    return events;
  }

  private extractProductionSamples(
    pages: string[],
    reportDate: string,
    fmt: DateFormat
  ): Date[] {
    const samples: Date[] = [];
    let currentDate = reportDate;
    for (const page of pages) {
      if (!/^\s*Production report(?!\.)/m.test(page)) continue;
      const body = this.pageBody(page);
      let m: RegExpExecArray | null;
      PRODUCTION_TOKEN_RE.lastIndex = 0;
      while ((m = PRODUCTION_TOKEN_RE.exec(body)) !== null) {
        if (m[1]) currentDate = m[1];
        else samples.push(parseVnDateTime(`${currentDate} ${m[2]}`, fmt));
      }
    }
    return samples;
  }

  private computeRunWindow(
    events: MachineEvent[],
    samples: Date[]
  ): { startTime: Date; endTime: Date; source: string } {
    const ms = (d: Date) => d.getTime();
    const ons = events.filter((e) => e.type === 'ON').map((e) => ms(e.time));

    if (ons.length > 0) {
      const start = Math.min(...ons);
      const offs = events
        .filter((e) => e.type === 'OFF' && ms(e.time) >= start)
        .map((e) => ms(e.time));
      if (offs.length > 0) {
        return { startTime: new Date(start), endTime: new Date(Math.max(...offs)), source: 'ON_OFF' };
      }
      // Máy chưa OFF (export khi đang chạy) → lấy mốc muộn nhất đang có
      const last = Math.max(start, ...events.map((e) => ms(e.time)), ...samples.map(ms));
      return { startTime: new Date(start), endTime: new Date(last), source: 'ON_LAST_EVENT' };
    }

    if (samples.length > 0) {
      return {
        startTime: new Date(Math.min(...samples.map(ms))),
        endTime: new Date(Math.max(...samples.map(ms))),
        source: 'PRODUCTION_SAMPLES',
      };
    }

    throw new Error('Fette parser: no Machine ON/OFF events and no production samples');
  }

  private extractProducedTablets(text: string): number | undefined {
    const m = text.match(/Produced tablets\s+(\d+)/);
    return m ? parseInt(m[1], 10) : undefined;
  }
}
