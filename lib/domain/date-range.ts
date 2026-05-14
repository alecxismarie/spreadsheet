const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export type DateRangeResult =
  | { ok: true; from?: Date; to?: Date }
  | { ok: false; message: string };

export function canonicalReportDate(value: unknown) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  if (typeof value !== "string") return undefined;
  return parseDateOnly(value);
}

export function startOfDateFilter(value?: string) {
  return parseDateOnly(value);
}

export function endOfDateFilter(value?: string) {
  const date = parseDateOnly(value);
  if (!date) return undefined;
  date.setHours(23, 59, 59, 999);
  return date;
}

export function parseDateRangeFilters(fromValue?: string, toValue?: string): DateRangeResult {
  const from = fromValue ? startOfDateFilter(fromValue) : undefined;
  const to = toValue ? endOfDateFilter(toValue) : undefined;

  if ((fromValue && !from) || (toValue && !to)) {
    return { ok: false, message: "Date filters must use valid YYYY-MM-DD dates." };
  }
  if (from && to && from > to) {
    return { ok: false, message: "Start date cannot be after end date." };
  }

  return { ok: true, from, to };
}

function parseDateOnly(value?: string) {
  if (!value) return undefined;
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return undefined;
  }

  return date;
}
