-- CreateTable
CREATE TABLE `ReportReviewComment` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `reportId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `statusContext` ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'NEEDS_REVIEW') NOT NULL,
    `body` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReportReviewComment_workspaceId_createdAt_idx`(`workspaceId`, `createdAt`),
    INDEX `ReportReviewComment_reportId_createdAt_idx`(`reportId`, `createdAt`),
    INDEX `ReportReviewComment_authorId_idx`(`authorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ReportReviewComment` ADD CONSTRAINT `ReportReviewComment_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReportReviewComment` ADD CONSTRAINT `ReportReviewComment_reportId_fkey` FOREIGN KEY (`reportId`) REFERENCES `SalesReport`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
