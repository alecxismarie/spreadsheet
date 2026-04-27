-- AlterTable
ALTER TABLE `ReportAuditLog` MODIFY `action` ENUM('CREATED', 'UPDATED', 'IMPORTED', 'IMPORT_REMOVED', 'SUBMITTED', 'RESUBMITTED', 'APPROVED', 'NEEDS_REVIEW') NOT NULL;

-- AlterTable
ALTER TABLE `SalesReportRow` ADD COLUMN `importBatchId` VARCHAR(191) NULL,
    ADD COLUMN `importFilename` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `SalesReportRow_reportId_importBatchId_idx` ON `SalesReportRow`(`reportId`, `importBatchId`);
