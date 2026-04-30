CREATE TABLE `WorkspaceInvitation` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `role` ENUM('OWNER', 'MANAGER', 'MEMBER') NOT NULL DEFAULT 'MEMBER',
    `tokenHash` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED') NOT NULL DEFAULT 'PENDING',
    `invitedById` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `acceptedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WorkspaceInvitation_tokenHash_key`(`tokenHash`),
    INDEX `WorkspaceInvitation_workspaceId_status_idx`(`workspaceId`, `status`),
    INDEX `WorkspaceInvitation_workspaceId_email_idx`(`workspaceId`, `email`),
    INDEX `WorkspaceInvitation_invitedById_idx`(`invitedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TeamAuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `action` ENUM('INVITE_CREATED', 'ROLE_CHANGED', 'MEMBER_DEACTIVATED', 'MEMBER_REACTIVATED') NOT NULL,
    `targetUserId` VARCHAR(191) NULL,
    `targetEmail` VARCHAR(191) NULL,
    `message` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TeamAuditLog_workspaceId_createdAt_idx`(`workspaceId`, `createdAt`),
    INDEX `TeamAuditLog_actorId_idx`(`actorId`),
    INDEX `TeamAuditLog_targetUserId_idx`(`targetUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `WorkspaceInvitation` ADD CONSTRAINT `WorkspaceInvitation_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `TeamAuditLog` ADD CONSTRAINT `TeamAuditLog_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
