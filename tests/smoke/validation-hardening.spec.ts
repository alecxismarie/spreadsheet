import { expect, test } from "@playwright/test";
import { parseDateRangeFilters } from "@/lib/domain/date-range";
import {
  DB_NUMERIC_LIMITS,
  DB_STRING_LIMITS,
  dbEmailSchema,
  parseDecimal12_2,
  parseNonNegativeMysqlInt
} from "@/lib/domain/db-constraints";
import { isReportUniqueConstraintError } from "@/lib/domain/report-uniqueness";

test("DB-aligned validation rejects oversized strings and invalid numbers", () => {
  expect(dbEmailSchema().safeParse(`${"a".repeat(DB_STRING_LIMITS.email)}@test.dev`).success).toBe(false);

  expect(parseDecimal12_2(DB_NUMERIC_LIMITS.decimal12_2Max + 0.01, "Sales amount")).toEqual({
    ok: false,
    message: "Sales amount cannot exceed 9999999999.99."
  });
  expect(parseDecimal12_2("12.345", "Sales amount")).toEqual({
    ok: false,
    message: "Sales amount cannot have more than 2 decimal places."
  });
  expect(parseDecimal12_2(Number.NaN, "Sales amount")).toEqual({
    ok: false,
    message: "Sales amount must be a finite number."
  });
  expect(parseDecimal12_2(Number.POSITIVE_INFINITY, "Sales amount")).toEqual({
    ok: false,
    message: "Sales amount must be a finite number."
  });
  expect(parseNonNegativeMysqlInt(DB_NUMERIC_LIMITS.mysqlSignedIntMax + 1, "Units sold")).toEqual({
    ok: false,
    message: "Units sold cannot exceed 2147483647."
  });
});

test("date filters reject invalid and inverted ranges", () => {
  expect(parseDateRangeFilters("2026-02-31", "2026-03-01")).toEqual({
    ok: false,
    message: "Date filters must use valid YYYY-MM-DD dates."
  });
  expect(parseDateRangeFilters("2026-05-02", "2026-05-01")).toEqual({
    ok: false,
    message: "Start date cannot be after end date."
  });
});

test("report uniqueness P2002 detection handles Prisma target shapes", () => {
  expect(
    isReportUniqueConstraintError({
      code: "P2002",
      meta: { target: ["workspaceId", "memberId", "periodId", "reportDate"] }
    })
  ).toBe(true);
  expect(
    isReportUniqueConstraintError({
      code: "P2002",
      meta: { target: "SalesReport_workspaceId_memberId_periodId_reportDate_key" }
    })
  ).toBe(true);
  expect(isReportUniqueConstraintError({ code: "P2002", meta: { target: ["email"] } })).toBe(false);
});
