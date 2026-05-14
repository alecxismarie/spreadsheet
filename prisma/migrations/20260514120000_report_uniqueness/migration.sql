-- Preflight before applying in any environment:
-- SELECT workspaceId, memberId, periodId, reportDate, COUNT(*) AS duplicateCount
-- FROM SalesReport
-- GROUP BY workspaceId, memberId, periodId, reportDate
-- HAVING COUNT(*) > 1;
--
-- This migration intentionally fails if duplicates exist. Clean duplicate draft
-- reports by retaining one canonical draft per key, and review submitted or
-- approved duplicates manually before applying the unique index.

CREATE UNIQUE INDEX `SalesReport_workspaceId_memberId_periodId_reportDate_key`
ON `SalesReport`(`workspaceId`, `memberId`, `periodId`, `reportDate`);
