/**
 * Convert các định dạng ngày giờ khác nhau về Date object.
 *
 * Máy sản xuất xuất date format khác nhau tùy locale máy tính điều khiển:
 *  - dd-mm-yyyy hoặc dd.mm.yyyy (VD: "21-08-2026", "12.11.2021" — kiểu VN/EU)
 *  - mm-dd-yyyy hoặc mm/dd/yyyy (VD: "02-26-2021", "11/29/2021" — kiểu Mỹ)
 *  - dd/mm/yyyy (VD: "18/9/2026" — máy ép vỉ FREMED)
 *
 * Vì cùng dấu "-" có thể là 2 format khác nhau giữa các máy, cần AUTO-DETECT
 * từ context của file bằng detectDateFormat(text) trước khi parse.
 */

export type DateFormat = 'dd/mm' | 'mm/dd';

/**
 * Scan toàn bộ text tìm timestamp có "day part > 12" hoặc "month part > 12"
 * để suy ra format chính xác.
 * Nếu không detect được (mọi số ≤ 12) → default dd/mm (kiểu VN).
 */
export function detectDateFormat(text: string): DateFormat {
  const datePattern = /(\d{1,2})([-./])(\d{1,2})\2\d{4}/g;
  let m: RegExpExecArray | null;
  while ((m = datePattern.exec(text)) !== null) {
    const p1 = parseInt(m[1], 10);
    const p2 = parseInt(m[3], 10);
    if (p1 > 12) return 'dd/mm';
    if (p2 > 12) return 'mm/dd';
  }
  return 'dd/mm';
}

/**
 * Convert 1 chuỗi datetime về Date object theo format đã biết.
 */
export function parseVnDateTime(input: string, format: DateFormat = 'dd/mm'): Date {
  const cleaned = input.trim().replace(/\s+/g, ' ');
  const [datePart, timePart] = cleaned.split(' ');
  if (!datePart || !timePart) {
    throw new Error(`Invalid datetime format: "${input}"`);
  }

  const dateParts = datePart.split(/[-./]/);
  if (dateParts.length !== 3) {
    throw new Error(`Invalid date part: "${datePart}"`);
  }

  let dd: string, mm: string, yyyy: string;
  if (format === 'mm/dd') {
    [mm, dd, yyyy] = dateParts;
  } else {
    [dd, mm, yyyy] = dateParts;
  }

  const timeParts = timePart.split(':');
  while (timeParts.length < 3) timeParts.push('00');
  const [hh, mi, ss] = timeParts;

  const iso = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T${hh.padStart(2, '0')}:${mi.padStart(2, '0')}:${ss.padStart(2, '0')}`;
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    throw new Error(`Cannot parse datetime: "${input}" (with format ${format})`);
  }
  return d;
}

/**
 * Convert chuỗi duration "H:MM:SS" hoặc "MM:SS" thành số giây
 */
export function durationToSeconds(hms: string): number {
  const parts = hms.trim().split(':').map(Number);
  if (parts.some(isNaN)) throw new Error(`Invalid duration: "${hms}"`);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  throw new Error(`Invalid duration format: "${hms}"`);
}
