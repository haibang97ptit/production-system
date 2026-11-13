import { BatchReportParser } from './base.parser';
import { ParsedBatchReport, ParsedStep } from '../types/batch.types';
import { parseVnDateTime, detectDateFormat, DateFormat } from '../utils/date.util';

/**
 * Parser cho máy dập viên Fette (P1010, P2020, ... — mọi model cùng format báo cáo).
 *
 * Steps = các chế độ chạy, lấy từ dòng "Change of run" trong Change report:
 *   "08:30:44  Change of run  chumnit.danh: [K] Setting run -> [L] Standard run"
 *   → Setting run → Standard run → Test run → ... (mỗi chế độ = 1 step).
 *   Chế độ "Computer run" (máy nghỉ / chờ) không tính là step. Steps được cắt theo
 *   thời gian chạy của batch (Machine ON đầu → OFF cuối).
 *   dataPoints = số mẫu đo trong Production report rơi vào khoảng thời gian của step.
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

const RUN_CHANGE_RE =
  /^\s*(\d{2}:\d{2}:\d{2})\s+Change of run\s+.*?\[[A-Z]\]\s*(.+?)\s*->\s*\[[A-Z]\]\s*(.+?)\s*$/;
// Chế độ máy nghỉ / chờ lệnh — không phải 1 giai đoạn sản xuất
const IDLE_MODES = new Set(['computer run']);
// 1 dòng Change report: "<giờ>  <loại sự kiện>  <nội dung>" (các cột cách nhau >= 2 dấu cách)
const EVENT_LINE_RE = /^\s*(\d{2}:\d{2}:\d{2})\s{2,}(.+?)\s{2,}(.+?)\s*$/;

interface MachineEvent {
  time: Date;
  type: 'ON' | 'OFF';
}

interface RunChange {
  time: Date;
  from: string;
  to: string;
  user?: string;
}

interface UserAction {
  time: Date;
  user: string;
}

/**
 * Lấy người thực hiện từ nội dung 1 dòng Change report:
 *   "kimda.nguyen: [L] Standard run -> [J] Test run"  → kimda.nguyen (trước dấu ":")
 *   "Operator level: 0 ->  7  kimda.nguyen"           → kimda.nguyen (cuối dòng)
 */
function extractActor(content: string): string | undefined {
  const level = content.match(/^Operator level:.*?(\S+)$/);
  if (level) return level[1];
  return content.match(/^([^\s:]+):\s/)?.[1];
}

/** Danh sách không trùng, giữ thứ tự xuất hiện */
function uniqueInOrder(items: (string | undefined)[]): string[] {
  return [...new Set(items.filter((x): x is string => !!x))];
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
    const { events, runChanges, actions, samples } = this.extractTimeline(pdfText);
    const runWindow = this.computeRunWindow(events, samples);
    const steps = this.buildModeSteps(runChanges, actions, samples, runWindow);
    const runOperators = this.actorsBetween(
      actions,
      runWindow.startTime.getTime(),
      runWindow.endTime.getTime(),
      true
    );

    return {
      batchNumber: productBatch.batchNumber,
      // Không set productCode: tránh ghi đè mã sản phẩm chính thức lấy từ report GEA
      productName: productBatch.productName,
      machineId: header.machineId,
      machineType: `Fette ${header.model}`,
      processType: 'Tabletting',
      operator: header.operator, // "Oper:" trên header = người export report
      startTime: runWindow.startTime,
      endTime: runWindow.endTime,
      durationSeconds: Math.round(
        (runWindow.endTime.getTime() - runWindow.startTime.getTime()) / 1000
      ),
      steps,
      metadata: {
        producedTablets: this.extractProducedTablets(pdfText),
        machineModel: header.model,
        machineNumber: header.machineId,
        runWindowSource: runWindow.source, // 'ON_OFF' | 'ON_LAST_EVENT' | 'PRODUCTION_SAMPLES'
        machineOnCount: events.filter((e) => e.type === 'ON').length,
        productionSamples: samples.length,
        operators: runOperators, // Tất cả người thao tác máy trong thời gian chạy batch
      },
    };
  }

  private extractTimeline(text: string): {
    events: MachineEvent[];
    runChanges: RunChange[];
    actions: UserAction[];
    samples: Date[];
  } {
    const dateFormat = detectDateFormat(text);
    const { reportDate } = this.parseHeader(text);
    const pages = text.split(/page:\s*\d+\s*\/\s*\d+/);
    return {
      ...this.extractChangeReport(pages, reportDate, dateFormat),
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

  private extractChangeReport(
    pages: string[],
    reportDate: string,
    fmt: DateFormat
  ): { events: MachineEvent[]; runChanges: RunChange[]; actions: UserAction[] } {
    const events: MachineEvent[] = [];
    const runChanges: RunChange[] = [];
    const actions: UserAction[] = [];
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
        const ev = line.match(EVENT_LINE_RE);
        if (!ev) continue;
        const time = parseVnDateTime(`${currentDate} ${ev[1]}`, fmt);
        const user = extractActor(ev[3]);
        if (user) actions.push({ time, user });

        const e = line.match(MACHINE_EVENT_RE);
        if (e) {
          events.push({ time, type: e[2] as 'ON' | 'OFF' });
          continue;
        }
        const r = line.match(RUN_CHANGE_RE);
        if (r) runChanges.push({ time, from: r[2], to: r[3], user });
      }
    }
    return { events, runChanges, actions };
  }

  /** Những người có thao tác trong [start, end) (hoặc [start, end] nếu includeEnd), theo thứ tự thời gian */
  private actorsBetween(
    actions: UserAction[],
    start: number,
    end: number,
    includeEnd: boolean
  ): string[] {
    return uniqueInOrder(
      actions
        .filter((a) => {
          const t = a.time.getTime();
          return t >= start && (t < end || (includeEnd && t === end));
        })
        .sort((a, b) => a.time.getTime() - b.time.getTime())
        .map((a) => a.user)
    );
  }

  /**
   * Dựng steps từ các lần đổi chế độ chạy (sắp xếp cũ → mới).
   * Step i = chế độ "to" của lần đổi i, kéo dài tới lần đổi kế tiếp
   * (lần cuối: tới hết thời gian chạy). Nếu thời gian chạy bắt đầu trước lần đổi
   * đầu tiên → thêm 1 step cho chế độ "from" ban đầu.
   */
  private buildModeSteps(
    runChanges: RunChange[],
    actions: UserAction[],
    samples: Date[],
    runWindow: { startTime: Date; endTime: Date }
  ): ParsedStep[] {
    if (runChanges.length === 0) return [];
    const changes = [...runChanges].sort((a, b) => a.time.getTime() - b.time.getTime());
    const runStart = runWindow.startTime.getTime();
    const runEnd = runWindow.endTime.getTime();

    type Segment = { name: string; start: number; end: number; starter?: string };
    const segments: Segment[] = [];
    if (runStart < changes[0].time.getTime()) {
      segments.push({ name: changes[0].from, start: runStart, end: changes[0].time.getTime() });
    }
    changes.forEach((c, i) => {
      const start = c.time.getTime();
      const end = i + 1 < changes.length ? changes[i + 1].time.getTime() : Math.max(runEnd, start);
      // starter = người đổi máy sang chế độ này
      segments.push({ name: c.to, start, end, starter: c.user });
    });

    // - Cắt theo thời gian chạy của batch: Change report có thể chứa sự kiện trước/sau batch
    //   (VD máy cài đặt cho batch sau nhưng chưa đổi số batch) → bỏ phần nằm ngoài.
    // - Bỏ chế độ nghỉ (Computer run) và đoạn dài 0 giây.
    // - Gộp 2 đoạn liền nhau cùng chế độ (log có thể ghi "Standard run -> Standard run").
    const merged: Segment[] = [];
    for (const seg of segments) {
      const start = Math.max(seg.start, runStart);
      const end = Math.min(seg.end, runEnd);
      if (end <= start || IDLE_MODES.has(seg.name.toLowerCase())) continue;
      const prev = merged[merged.length - 1];
      if (prev && prev.name === seg.name && prev.end === start) prev.end = end;
      else merged.push({ name: seg.name, start, end, starter: seg.starter });
    }

    const sampleMs = samples.map((s) => s.getTime());
    return merged.map((s, i) => {
      const isLast = i === merged.length - 1; // mốc đúng lúc kết thúc batch tính cho step cuối
      // operators: người bắt đầu step (người đổi chế độ chạy) đứng đầu,
      // sau đó là những người khác có thao tác trong step, theo thứ tự thời gian
      const operators = uniqueInOrder([s.starter, ...this.actorsBetween(actions, s.start, s.end, isLast)]);
      return {
        stepCounter: i + 1,
        stepName: s.name,
        startTime: new Date(s.start),
        endTime: new Date(s.end),
        durationSeconds: Math.round((s.end - s.start) / 1000),
        dataPoints: sampleMs.filter((t) => t >= s.start && (t < s.end || (isLast && t === s.end)))
          .length,
        operators,
      };
    });
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
