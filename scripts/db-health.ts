import "dotenv/config";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.$queryRaw`SELECT 1`;
  console.log("Database connection OK.");

  try {
    const [userCount, workspaceCount, periodCount] = await Promise.all([
      prisma.user.count(),
      prisma.workspace.count(),
      prisma.reportingPeriod.count()
    ]);

    console.log(`Users: ${userCount}`);
    console.log(`Workspaces: ${workspaceCount}`);
    console.log(`Reporting periods: ${periodCount}`);
  } catch {
    console.log("Schema tables are not available yet. Run npm run prisma:migrate, then npm run prisma:seed.");
  }
}

main()
  .catch((error) => {
    console.error("Database health check failed.");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
