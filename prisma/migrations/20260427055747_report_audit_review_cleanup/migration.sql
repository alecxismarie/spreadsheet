-- CreateTable
CREATE TABLE `ReportAuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `reportId` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `action` ENUM('CREATED', 'UPDATED', 'SUBMITTED', 'APPROVED', 'NEEDS_REVIEW') NOT NULL,
    `message` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReportAuditLog_workspaceId_createdAt_idx`(`workspaceId`, `createdAt`),
    INDEX `ReportAuditLog_reportId_createdAt_idx`(`reportId`, `createdAt`),
    INDEX `ReportAuditLog_actorId_idx`(`actorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ReportAuditLog` ADD CONSTRAINT `ReportAuditLog_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReportAuditLog` ADD CONSTRAINT `ReportAuditLog_reportId_fkey` FOREIGN KEY (`reportId`) REFERENCES `SalesReport`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
