import { PrismaClient, ReportingPeriodType, Role, SubmissionStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { addDays, endOfMonth, startOfMonth } from "date-fns";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("demo1234", 10);
  const today = new Date();
  const periodStart = startOfMonth(today);
  const periodEnd = endOfMonth(today);

  await prisma.workspace.upsert({
    where: { slug: "northstar-sales" },
    update: {},
    create: {
      name: "Northstar Sales",
      slug: "northstar-sales",
      periods: {
        create: [
          {
            type: ReportingPeriodType.MONTHLY,
            label: "Current Month",
            startDate: periodStart,
            endDate: periodEnd
          },
          {
            type: ReportingPeriodType.WEEKLY,
            label: "Current Week",
            startDate: today,
            endDate: addDays(today, 6)
          }
        ]
      }
    }
  });

  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { slug: "northstar-sales" },
    include: { periods: true }
  });
  const monthlyPeriod = workspace.periods.find((period) => period.type === "MONTHLY")!;

  const people = [
    ["owner@northstar.test", "Avery Chen", Role.OWNER],
    ["manager@northstar.test", "Jordan Lee", Role.MANAGER],
    ["maria@northstar.test", "Maria Santos", Role.MEMBER],
    ["devon@northstar.test", "Devon Price", Role.MEMBER],
    ["samira@northstar.test", "Samira Khan", Role.MEMBER]
  ] as const;

  for (const [email, name, role] of people) {
    const user = await prisma.user.upsert({
      where: { email },
      update: { name, passwordHash },
      create: { email, name, passwordHash }
    });

    await prisma.membership.upsert({
      where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
      update: { role, active: true },
      create: { userId: user.id, workspaceId: workspace.id, role }
    });
  }

  const members = await prisma.user.findMany({
    where: { email: { in: ["maria@northstar.test", "devon@northstar.test", "samira@northstar.test"] } }
  });

  for (const member of members) {
    const targetAmount = member.email.startsWith("maria")
      ? 75000
      : member.email.startsWith("devon")
        ? 68000
        : 62000;
    await prisma.salesTarget.upsert({
      where: {
        workspaceId_memberId_periodId: {
          workspaceId: workspace.id,
          memberId: member.id,
          periodId: monthlyPeriod.id
        }
      },
      update: { amount: targetAmount, units: 120 },
      create: {
        workspaceId: workspace.id,
        memberId: member.id,
        periodId: monthlyPeriod.id,
        amount: targetAmount,
        units: 120
      }
    });
  }

  const reportSeeds = [
    {
      email: "maria@northstar.test",
      status: SubmissionStatus.SUBMITTED,
      rows: [
        ["Acme Manufacturing", "Enterprise Plan", 28500, 18],
        ["Brightline Retail", "Expansion Pack", 22400, 16],
        ["Cobalt Logistics", "Services", 14150, 8]
      ]
    },
    {
      email: "devon@northstar.test",
      status: SubmissionStatus.DRAFT,
      rows: [
        ["Helio Foods", "Enterprise Plan", 18900, 12],
        ["Riverbend Health", "Services", 9200, 6]
      ]
    },
    {
      email: "samira@northstar.test",
      status: SubmissionStatus.NEEDS_REVIEW,
      rows: [
        ["Atlas Supply", "Expansion Pack", 17400, 10],
        ["North Pier Energy", "Enterprise Plan", 19900, 11]
      ]
    }
  ] as const;

  for (const seed of reportSeeds) {
    const member = members.find((candidate) => candidate.email === seed.email)!;
    const existingSeedReport = await prisma.salesReport.findFirst({
      where: {
        workspaceId: workspace.id,
        memberId: member.id,
        periodId: monthlyPeriod.id,
        rows: { some: { customer: seed.rows[0][0] } }
      }
    });
    if (existingSeedReport) continue;

    const report = await prisma.salesReport.create({
      data: {
        workspaceId: workspace.id,
        memberId: member.id,
        periodId: monthlyPeriod.id,
        reportDate: today,
        status: seed.status,
        submittedAt: seed.status === SubmissionStatus.SUBMITTED ? today : null,
        notes: seed.status === SubmissionStatus.NEEDS_REVIEW ? "Manager review requested for discount variance." : null
      }
    });

    await prisma.salesReportRow.createMany({
      data: seed.rows.map(([customer, product, salesAmount, unitsSold], index) => ({
        reportId: report.id,
        customer,
        product,
        salesAmount,
        unitsSold,
        rowOrder: index
      }))
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
