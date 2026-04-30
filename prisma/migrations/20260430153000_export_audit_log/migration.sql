CREATE TABLE `WorkspaceExportAuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `format` VARCHAR(191) NOT NULL,
    `filtersJson` TEXT NOT NULL,
    `reportCount` INTEGER NOT NULL,
    `rowCount` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WorkspaceExportAuditLog_workspaceId_createdAt_idx`(`workspaceId`, `createdAt`),
    INDEX `WorkspaceExportAuditLog_actorId_idx`(`actorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `WorkspaceExportAuditLog` ADD CONSTRAINT `WorkspaceExportAuditLog_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
