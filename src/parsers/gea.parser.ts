import { BatchReportParser } from './base.parser';
import { ParsedBatchReport, ParsedStep } from '../types/batch.types';
import {
  parseVnDateTime,
  durationToSeconds,
  detectDateFormat,
  DateFormat,
} from '../utils/date.util';

/**
 * Parser GENERIC cho tất cả máy vendor GEA (dùng chung format báo cáo).
 * Hỗ trợ: CMi 400, CMi 1200, HSG PRO 200, GFB PRO 30, và mọi máy khác cùng format.
 *
 * Không hardcode model — tự động extract machineType/processType/dateFormat từ file.
 * Thêm máy GEA mới cùng format = KHÔNG phải sửa code.
 */
export class GeaBatchReportParser implements BatchReportParser {
  readonly machineType = 'GEA (generic)';

  private readonly DATE_PATTERN =
    '\\d{1,2}[-./]\\d{1,2}[-./]\\d{4}\\s+\\d{1,2}:\\d{2}:\\d{2}';

  canParse(pdfText: string): boolean {
    return (
      /General Batch Information/i.test(pdfText) &&
      /Batch Number:/i.test(pdfText) &&
      /Recipe Report/i.test(pdfText) &&
      /Step Counter:/i.test(pdfText)
    );
  }

  parse(pdfText: string): ParsedBatchReport {
    const dateFormat = detectDateFormat(pdfText);

    const general = this.parseGeneralInfo(pdfText);
    const steps = this.parseSteps(pdfText, dateFormat);

    if (steps.length === 0) {
      throw new Error('GEA parser: could not extract any step');
    }

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
    };
  }

  private parseGeneralInfo(text: string): {
    batchNumber: string;
    productCode?: string;
    productName?: string;
    machineId: string;
    machineType: string;
    processType?: string;
    operator?: string;
  } {
    const machineMatch = text.match(
      /\n([A-Z][A-Za-z0-9 ]+?)([A-Z]{2}\d{6,8})\nType:/
    );
    if (!machineMatch) {
      throw new Error('Cannot parse machine header (Model + ProjectNumber)');
    }
    const machineType = machineMatch[1].trim();
    const machineId = machineMatch[2];

    // Batch header: <Start><End><Batch><Recipe>
    // Batch: alphanumeric + dấu "-" (VD: EN2603501, 250826, 001-02032022)
    const headerRegex = new RegExp(
      `(${this.DATE_PATTERN})(${this.DATE_PATTERN})([A-Za-z0-9-]*[0-9-])(?=[A-Za-z])`
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

    const usersMatch = text.match(/([A-Za-z ]+)\nBatch Start User:/);
    let operator: string | undefined;
    if (usersMatch) {
      const full = usersMatch[1].trim();
      const half = full.length / 2;
      if (full.length % 2 === 0 && full.slice(0, half) === full.slice(half)) {
        operator = full.slice(0, half).trim();
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
    };
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

    const timingRegex = new RegExp(
      `(${this.DATE_PATTERN})\\n(${this.DATE_PATTERN})\\n\\s*(\\d+:\\d{2}:\\d{2}|N/A)\\n\\s*Step Start Time:\\n\\s*Step End Time:\\n\\s*Step Duration:`,
      'g'
    );
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
