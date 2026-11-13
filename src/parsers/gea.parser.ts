import { BatchReportParser } from './base.parser';
import { ParsedBatchReport, ParsedStep } from '../types/batch.types';
import {
  parseVnDateTime,
  durationToSeconds,
  detectDateFormatStrict,
  DateFormat,
} from '../utils/date.util';

/** 1 sự kiện trong mục "Alarms & Events" */
interface GeaEvent {
  description: string;
  type: string;
  stamp: string; // chuỗi ngày giờ gốc, VD "11/12/2026  15:52:23"
  user?: string; // người thực hiện, lấy từ đuôi "- by Dang Phat Vinh"
}

const EVENT_STAMP_LINE_RE = /^\s*(\d{1,2}[-./]\d{1,2}[-./]\d{4}\s+\d{1,2}:\d{2}:\d{2})\s*$/;

/**
 * Parser GENERIC cho tất cả máy vendor GEA (dùng chung format báo cáo).
 * Hỗ trợ: CMi 400, CMi 1200, HSG PRO 200/600, GFB PRO 30/60, GCSi 350, và mọi máy khác cùng format.
 *
 * Không hardcode model — tự động extract machineType/processType/dateFormat từ file.
 * Thêm máy GEA mới cùng format = KHÔNG phải sửa code.
 *
 * LƯU Ý ngày tháng: trong CÙNG 1 file, phần header/recipe và phần giờ step/sự kiện có thể
 * dùng 2 định dạng khác nhau (VD GFB PRO 60: header "12/11/2026" = ngày/tháng, step
 * "11/12/2026" = tháng/ngày). → Định dạng của giờ step/sự kiện được xác định riêng.
 *
 * Người thực hiện từng step: lấy từ các sự kiện "... - by <tên>" trong Alarms & Events,
 * gán vào step theo thời gian.
 */
export class GeaBatchReportParser implements BatchReportParser {
  readonly machineType = 'GEA (generic)';

  private readonly DATE_PATTERN =
    '\\d{1,2}[-./]\\d{1,2}[-./]\\d{4}\\s+\\d{1,2}:\\d{2}:\\d{2}';

  private timingRegex(): RegExp {
    return new RegExp(
      `(${this.DATE_PATTERN})\\n(${this.DATE_PATTERN})\\n\\s*(\\d+:\\d{2}:\\d{2}|N/A)\\n\\s*Step Start Time:\\n\\s*Step End Time:\\n\\s*Step Duration:`,
      'g'
    );
  }

  canParse(pdfText: string): boolean {
    return (
      /General Batch Information/i.test(pdfText) &&
      /Batch Number:/i.test(pdfText) &&
      /Recipe Report/i.test(pdfText) &&
      /Step Counter:/i.test(pdfText)
    );
  }

  parse(pdfText: string): ParsedBatchReport {
    const general = this.parseGeneralInfo(pdfText);
    const events = this.extractEvents(pdfText);
    const stepStamps = [...pdfText.matchAll(this.timingRegex())].flatMap((m) => [m[1], m[2]]);
    const stampFormat = this.detectStampFormat(
      pdfText,
      [...stepStamps, ...events.map((e) => e.stamp)],
      stepStamps[0],
      general.headerStart
    );

    const steps = this.parseSteps(pdfText, stampFormat);
    if (steps.length === 0) {
      throw new Error('GEA parser: could not extract any step');
    }
    this.assignStepOperators(steps, events, stampFormat, general.operator);

    return {
      batchNumber: general.batchNumber,
      productCode: general.productCode,
      productName: general.productName,
      machineId: general.machineId,
      machineType: general.machineType,
      processType: general.processType,
      operator: general.operator,
      startTime: steps[0].startTime,
      endTime: steps[steps.length - 1].endTime,
      durationSeconds: Math.round(
        (steps[steps.length - 1].endTime.getTime() -
          steps[0].startTime.getTime()) /
          1000
      ),
      steps,
      metadata: general.batchEndUser ? { batchEndUser: general.batchEndUser } : undefined,
    };
  }

  private parseGeneralInfo(text: string): {
    batchNumber: string;
    productCode?: string;
    productName?: string;
    machineId: string;
    machineType: string;
    processType?: string;
    operator?: string; // Batch Start User
    batchEndUser?: string;
    headerStart: string; // "Start Date/Time" trên header (chuỗi gốc)
  } {
    const machineMatch = text.match(
      /\n([A-Z][A-Za-z0-9 ]+?)([A-Z]{2}\d{6,8})\nType:/
    );
    if (!machineMatch) {
      throw new Error('Cannot parse machine header (Model + ProjectNumber)');
    }
    const machineType = machineMatch[1].trim();
    const machineId = machineMatch[2];

    // Batch header có 2 layout PDF:
    //   KIỂU A (CMi 400, HSG cũ): batch và recipe CÙNG dòng
    //     "21-08-2026 17:52:0021-08-2026 18:01:38EN2603501MIDITEL 80 - R.GR..."
    //   KIỂU B (CMi 1200 mới): batch cuối dòng, recipe DÒNG RIÊNG bên dưới
    //     "24/03/2025 16:21:1424/03/2025 21:10:15250045-01\n"
    //     "FREMEDOL FLU - R.GR0046 - V01"
    //
    // Batch: alphanumeric + dấu "-" (VD: EN2603501, 250826, 001-02032022, 250045-01)
    // Lookahead:
    //   - Kiểu A: [A-Z][A-Za-z] (2 chữ cái đầu recipe name, VD "MI", "Fr", "PL")
    //   - Kiểu B: $ với flag 'm' (cuối dòng)
    const headerRegex = new RegExp(
      `(${this.DATE_PATTERN})(${this.DATE_PATTERN})([A-Za-z0-9-]+?)(?=[A-Z][A-Za-z]|$)`,
      'm'
    );
    const headerMatch = text.match(headerRegex);
    if (!headerMatch) {
      throw new Error('Cannot parse batch header line');
    }
    const batchNumber = headerMatch[3];

    let processType: string | undefined;
    const ptSameLine = text.match(/Process Type:[ \t]+([^\n]+)/);
    if (ptSameLine) {
      processType = ptSameLine[1].trim();
    } else {
      const ptPrevLine = text.match(/\n([^\n]+?)\nProcess Type:/);
      if (ptPrevLine) processType = ptPrevLine[1].trim();
    }

    const productCodeMatch = text.match(/([A-Za-z0-9_-]+)\nProduct Code -:/);
    const productNameMatch = text.match(/([A-Za-z0-9 _-]+)\nProduct Name -:/);

    // Dòng trước "Batch Start User:" là tên người bắt đầu + người kết thúc batch DÍNH LIỀN nhau:
    //   "Dang Phat VinhDang Phat Vinh"   → bắt đầu = kết thúc = Dang Phat Vinh
    //   "Mai Hoang ThoaiDang Phat Vinh"  → bắt đầu Mai Hoang Thoai, kết thúc Dang Phat Vinh
    // Chỗ nối = chữ thường đứng liền chữ hoa (trong 1 tên các chữ luôn cách nhau dấu cách).
    const usersMatch = text.match(/([A-Za-z ]+)\nBatch Start User:/);
    let operator: string | undefined;
    let batchEndUser: string | undefined;
    if (usersMatch) {
      const full = usersMatch[1].trim();
      const parts = full.split(/(?<=[a-z])(?=[A-Z])/).map((p) => p.trim());
      if (parts.length === 2) {
        [operator, batchEndUser] = parts;
      } else {
        operator = full;
      }
    }

    return {
      batchNumber,
      productCode: productCodeMatch?.[1],
      productName: productNameMatch?.[1]?.trim(),
      machineId,
      machineType,
      processType,
      operator,
      batchEndUser,
      headerStart: headerMatch[1],
    };
  }

  /**
   * Xác định định dạng ngày của giờ step / sự kiện:
   *  1. Trong chính các mốc đó có ngày > 12 hoặc tháng > 12 → biết chắc.
   *  2. Không thì: xác định định dạng của phần còn lại (header, recipe...), đọc giờ bắt đầu
   *     trên header, rồi chọn cách đọc giờ step đầu tiên cho kết quả GẦN header nhất.
   *     VD header "12/11/2026 15:45:06" (ngày/tháng → 12/11), step "11/12/2026 15:45:12":
   *     đọc tháng/ngày → 12/11 (lệch 6 giây) ✓, đọc ngày/tháng → 11/12 (lệch 1 tháng) ✗.
   */
  private detectStampFormat(
    text: string,
    stamps: string[],
    firstStepStart: string | undefined,
    headerStart: string
  ): DateFormat {
    const strict = detectDateFormatStrict(stamps.join('\n'));
    if (strict) return strict;

    let rest = text;
    for (const s of new Set(stamps)) rest = rest.split(s).join(' ');
    const headerFormat = detectDateFormatStrict(rest) ?? 'dd/mm';
    if (!firstStepStart) return headerFormat;

    const tryParse = (s: string, f: DateFormat): number | null => {
      try {
        return parseVnDateTime(s, f).getTime();
      } catch {
        return null;
      }
    };
    const ref = tryParse(headerStart, headerFormat);
    if (ref === null) return headerFormat;
    const gap = (f: DateFormat) => {
      const t = tryParse(firstStepStart, f);
      return t === null ? Infinity : Math.abs(t - ref);
    };
    const ddGap = gap('dd/mm');
    const mmGap = gap('mm/dd');
    if (ddGap === mmGap) return headerFormat;
    return ddGap < mmGap ? 'dd/mm' : 'mm/dd';
  }

  /**
   * Đọc mục "Alarms & Events". Mỗi sự kiện trong text PDF có dạng:
   *   <nội dung, có thể xuống nhiều dòng — bị cắt giữa chữ, VD "by D" + "ang Phat Vinh">
   *   <loại sự kiện>            VD "Incoming Conf."
   *   <ngày giờ>                VD "11/12/2026  15:52:23"
   */
  private extractEvents(text: string): GeaEvent[] {
    const events: GeaEvent[] = [];
    const sectionRe = /Alarms & Events\n([\s\S]*?)(?=Print Date\/Time:|$)/g;
    for (const section of text.matchAll(sectionRe)) {
      let buffer: string[] = [];
      for (const line of section[1].split('\n')) {
        const stamp = line.match(EVENT_STAMP_LINE_RE);
        if (!stamp) {
          buffer.push(line);
          continue;
        }
        const type = (buffer.pop() ?? '').trim();
        // Nối thẳng, không thêm dấu cách: PDF cắt dòng giữa chữ nhưng giữ nguyên dấu cách gốc
        const description = buffer.join('').replace(/\s+/g, ' ').trim();
        buffer = [];
        if (!description) continue;
        const user = description.match(/\s-\s*by\s+(.+?)\s*$/)?.[1];
        events.push({ description, type, stamp: stamp[1], user });
      }
    }
    return events;
  }

  /**
   * operators của step = những người có sự kiện "- by <tên>" trong khoảng thời gian của step,
   * theo thứ tự thời gian. Step không có sự kiện nào ghi tên → lấy người thao tác gần nhất
   * ở step trước; step đầu tiên → người bắt đầu batch (Batch Start User).
   * Sự kiện trước khi batch bắt đầu (VD xác nhận alarm từ sáng) không tính vào step nào.
   */
  private assignStepOperators(
    steps: ParsedStep[],
    events: GeaEvent[],
    fmt: DateFormat,
    batchStartUser?: string
  ): void {
    const userEvents = events
      .filter((e) => e.user)
      .map((e) => {
        try {
          return { time: parseVnDateTime(e.stamp, fmt).getTime(), user: e.user as string };
        } catch {
          return null;
        }
      })
      .filter((e): e is { time: number; user: string } => e !== null)
      .sort((a, b) => a.time - b.time);

    let lastKnown: string | undefined = batchStartUser;
    steps.forEach((step, i) => {
      const start = step.startTime.getTime();
      const end = step.endTime.getTime();
      const isLast = i === steps.length - 1;
      const users = [
        ...new Set(
          userEvents
            .filter((e) => e.time >= start && (e.time < end || (isLast && e.time === end)))
            .map((e) => e.user)
        ),
      ];
      step.operators = users.length > 0 ? users : lastKnown ? [lastKnown] : [];
      if (users.length > 0) lastKnown = users[users.length - 1];
    });
  }

  private parseSteps(text: string, dateFormat: DateFormat): ParsedStep[] {
    const stepDefRegex = /Step Counter:\n(\d+)\nStep Name:\n([^\n]+)/g;
    const stepDefs: { counter: number; name: string }[] = [];
    const seen = new Set<number>();
    let m: RegExpExecArray | null;

    while ((m = stepDefRegex.exec(text)) !== null) {
      const counter = parseInt(m[1], 10);
      if (!seen.has(counter)) {
        seen.add(counter);
        stepDefs.push({ counter, name: m[2].trim() });
      }
    }

    const timingRegex = this.timingRegex();
    const timings: { startTime: Date; endTime: Date; duration: string }[] = [];
    while ((m = timingRegex.exec(text)) !== null) {
      timings.push({
        startTime: parseVnDateTime(m[1], dateFormat),
        endTime: parseVnDateTime(m[2], dateFormat),
        duration: m[3].trim(),
      });
    }

    const dataPointsRegex = /\n(\d+)\nMin\nMax\n/g;
    const dataPointsList: number[] = [];
    while ((m = dataPointsRegex.exec(text)) !== null) {
      dataPointsList.push(parseInt(m[1], 10));
    }

    return stepDefs.map((def, i) => {
      const t = timings[i];
      if (!t) throw new Error(`Missing timing data for step ${def.counter}`);
      const durationSeconds =
        t.duration === 'N/A'
          ? Math.round((t.endTime.getTime() - t.startTime.getTime()) / 1000)
          : durationToSeconds(t.duration);
      return {
        stepCounter: def.counter,
        stepName: def.name,
        startTime: t.startTime,
        endTime: t.endTime,
        durationSeconds,
        dataPoints: dataPointsList[i],
      };
    });
  }
}
