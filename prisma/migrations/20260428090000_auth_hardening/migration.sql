-- AlterTable
ALTER TABLE `User` ADD COLUMN `sessionVersion` INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE `AuthRateLimit` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `ipHash` VARCHAR(191) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `windowStartedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lockedUntil` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AuthRateLimit_key_key`(`key`),
    INDEX `AuthRateLimit_email_idx`(`email`),
    INDEX `AuthRateLimit_lockedUntil_idx`(`lockedUntil`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
