import { z } from "zod";

export const DB_STRING_LIMITS = {
  email: 191,
  reportCustomer: 191,
  reportProduct: 191
} as const;

export const DB_NUMERIC_LIMITS = {
  decimal12_2Max: 9_999_999_999.99,
  mysqlSignedIntMax: 2_147_483_647
} as const;

type ParsedNumber = { ok: true; value: number } | { ok: false; message: string };

export function dbVarcharSchema(label: string, maxLength: number) {
  return z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(maxLength, `${label} must be ${maxLength} characters or fewer.`);
}

export function dbEmailSchema(message = "Enter a valid email address.") {
  return z
    .string()
    .trim()
    .max(DB_STRING_LIMITS.email, `Email must be ${DB_STRING_LIMITS.email} characters or fewer.`)
    .email(message)
    .toLowerCase();
}

export function decimal12_2Schema(label: string) {
  return z.unknown().transform((value, ctx) => {
    const parsed = parseDecimal12_2(value, label);
    if (!parsed.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: parsed.message });
      return z.NEVER;
    }
    return parsed.value;
  });
}

export function nonNegativeIntSchema(label: string) {
  return z.unknown().transform((value, ctx) => {
    const parsed = parseNonNegativeMysqlInt(value, label);
    if (!parsed.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: parsed.message });
      return z.NEVER;
    }
    return parsed.value;
  });
}

export function parseDecimal12_2(value: unknown, label: string): ParsedNumber {
  const normalized = normalizeNumericInput(value);
  if (normalized == null) return { ok: false, message: `${label} must be a finite number.` };

  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return { ok: false, message: `${label} must be a finite number.` };
  if (amount < 0) return { ok: false, message: `${label} cannot be negative.` };
  if (amount > DB_NUMERIC_LIMITS.decimal12_2Max) {
    return { ok: false, message: `${label} cannot exceed ${DB_NUMERIC_LIMITS.decimal12_2Max.toFixed(2)}.` };
  }
  if (!hasAtMostDecimalPlaces(normalized, amount, 2)) {
    return { ok: false, message: `${label} cannot have more than 2 decimal places.` };
  }

  return { ok: true, value: amount };
}

export function parseNonNegativeMysqlInt(value: unknown, label: string): ParsedNumber {
  const normalized = normalizeNumericInput(value);
  if (normalized == null) return { ok: false, message: `${label} must be a whole number.` };

  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return { ok: false, message: `${label} must be a finite whole number.` };
  if (!Number.isInteger(amount)) return { ok: false, message: `${label} must be a whole number.` };
  if (amount < 0) return { ok: false, message: `${label} cannot be negative.` };
  if (amount > DB_NUMERIC_LIMITS.mysqlSignedIntMax) {
    return { ok: false, message: `${label} cannot exceed ${DB_NUMERIC_LIMITS.mysqlSignedIntMax}.` };
  }

  return { ok: true, value: amount };
}

function normalizeNumericInput(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function hasAtMostDecimalPlaces(raw: string | number, value: number, maxPlaces: number) {
  if (typeof raw === "string" && !raw.toLowerCase().includes("e")) {
    const decimalPart = raw.split(".")[1];
    return !decimalPart || decimalPart.length <= maxPlaces;
  }

  const factor = 10 ** maxPlaces;
  return Math.abs(value * factor - Math.trunc(value * factor)) < Number.EPSILON;
}
