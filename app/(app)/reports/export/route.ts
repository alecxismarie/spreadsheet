import { NextResponse, type NextRequest } from "next/server";
import { parseFilters } from "@/lib/domain/filters";
import { requireCurrentSession } from "@/lib/auth/session";
import { buildSalesReportsCsv, recordSalesReportsExport, salesReportsExportFilename } from "@/lib/services/report-export";

export async function GET(request: NextRequest) {
  const session = await requireCurrentSession();
  const filters = parseFilters(Object.fromEntries(request.nextUrl.searchParams.entries()));
  const { csv, summary } = await buildSalesReportsCsv(session, filters);
  const filename = salesReportsExportFilename();

  try {
    await recordSalesReportsExport(session, filters, summary);
  } catch (error) {
    console.error("Failed to record sales reports export audit log.", error);
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store"
    }
  });
}
