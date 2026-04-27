import { ReportingPeriodType, SubmissionStatus } from "@prisma/client";
import { z } from "zod";

export const oversightFilterSchema = z.object({
  memberId: z.string().optional(),
  periodId: z.string().optional(),
  periodType: z.nativeEnum(ReportingPeriodType).optional(),
  status: z.nativeEnum(SubmissionStatus).optional(),
  from: z.string().optional(),
  to: z.string().optional()
});

export type OversightFilters = z.infer<typeof oversightFilterSchema>;

export function parseFilters(searchParams: Record<string, string | string[] | undefined>) {
  const raw = Object.fromEntries(
    Object.entries(searchParams).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])
  );
  const parsed = oversightFilterSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}
