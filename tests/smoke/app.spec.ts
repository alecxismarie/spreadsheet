import { expect, test, type Page } from "@playwright/test";
import { PrismaClient, type SubmissionStatus } from "@prisma/client";

const prisma = new PrismaClient();
const password = "demo1234";
const users = {
  owner: "owner@northstar.test",
  manager: "manager@northstar.test",
  member: "maria@northstar.test"
};
const smokeCustomerPrefix = "SMOKE TEST ";
const rateLimitEmailPrefix = "smoke-rate-limit-";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await cleanupSmokeData();
});

test.afterAll(async () => {
  await cleanupSmokeData();
  await prisma.$disconnect();
});

test("protected routes redirect unauthenticated users", async ({ page }) => {
  await page.goto("/overview");
  await expect(page).toHaveURL(/\/signin$/);
});

test("seeded owner, manager, and member can sign in", async ({ page }) => {
  for (const email of [users.owner, users.manager, users.member]) {
    await signIn(page, email);
    await expect(page).toHaveURL(/\/overview$/);
    await signOut(page);
  }
});

test("failed sign-in attempts are rate limited", async ({ page }) => {
  const email = `${rateLimitEmailPrefix}${Date.now()}@northstar.test`;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.goto("/signin");
    await page.getByTestId("sign-in-email").fill(email);
    await page.getByTestId("sign-in-password").fill(`wrong-password-${attempt}`);
    await expect(page.getByTestId("sign-in-submit")).toBeEnabled();
    await page.getByTestId("sign-in-submit").click();
    await expect(page.getByText("Invalid email or password.")).toBeVisible();
    await waitForRateLimitAttempts(email, attempt + 1);
  }

  await page.goto("/signin");
  await page.getByTestId("sign-in-email").fill(email);
  await page.getByTestId("sign-in-password").fill("wrong-password-locked");
  await expect(page.getByTestId("sign-in-submit")).toBeEnabled();
  await page.getByTestId("sign-in-submit").click();
  await expect(page.getByText("Too many sign-in attempts. Try again later.")).toBeVisible();
});

test("member report lifecycle, manager review, approval, and CSV import smoke", async ({ page }) => {
  const runPrefix = `${smokeCustomerPrefix}${Date.now()} `;
  const customer = `${runPrefix}Account`;
  const importCustomer = `${runPrefix}Import`;

  await signIn(page, users.member);
  await page.goto("/reports");
  await page.getByTestId("report-new").click();
  await page.getByTestId("report-row-customer-0").fill(customer);
  await page.getByTestId("report-row-product-0").fill("Smoke Plan");
  await page.getByTestId("report-row-sales-0").fill("1250.50");
  await page.getByTestId("report-row-units-0").fill("3");
  await page.getByTestId("report-save-draft").click();
  await expect(page.getByText("Changes saved.")).toBeVisible();

  const draft = await waitForReportByCustomer(customer, "DRAFT");
  await page.getByTestId(`report-list-item-${draft.id}`).click();
  await page.getByTestId("report-submit").click();
  await expect(page.getByText("Report submitted.")).toBeVisible();
  await waitForReportStatus(draft.id, "SUBMITTED");
  await signOut(page);

  await signIn(page, users.manager);
  await page.goto("/reports");
  await page.getByTestId(`report-list-item-${draft.id}`).click();
  await page.getByTestId("review-note").fill("Smoke review note");
  await page.getByTestId("review-needs-review").click();
  await waitForReportStatus(draft.id, "NEEDS_REVIEW");
  await signOut(page);

  await signIn(page, users.member);
  await page.goto("/reports");
  await page.getByTestId(`report-list-item-${draft.id}`).click();
  await expect(page.getByText("This report needs review.")).toBeVisible();
  await page.getByTestId("report-row-units-0").fill("4");
  await page.getByTestId("report-submit").click();
  await waitForReportStatus(draft.id, "SUBMITTED");
  await signOut(page);

  await signIn(page, users.manager);
  await page.goto("/reports");
  await page.getByTestId(`report-list-item-${draft.id}`).click();
  await page.getByTestId("review-approve").click();
  await waitForReportStatus(draft.id, "APPROVED");
  await signOut(page);

  await signIn(page, users.member);
  await page.goto("/reports");
  await page.getByTestId("import-toggle").click();
  await page.getByTestId("import-file").setInputFiles({
    name: "smoke-import.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`Customer,Product,Sales Amount,Units Sold,Notes\n${importCustomer},Import Plan,99.50,2,Imported by smoke test`)
  });
  await page.getByTestId("import-preview").click();
  await expect(page.getByText("Parsed 1 row.")).toBeVisible();
  await page.getByTestId("import-submit").click();
  await expect(page.getByText("Imported 1 row into a draft report.")).toBeVisible();
  await waitForReportByCustomer(importCustomer, "DRAFT");
  await signOut(page);
});

test("CSV export respects permissions, filters, and formula sanitization", async ({ page }) => {
  const records = await createSmokeExportRecords();

  await signIn(page, users.manager);
  const managerExport = await page.context().request.get(`/reports/export?memberId=${records.memberId}&status=SUBMITTED`);
  expect(managerExport.ok()).toBeTruthy();
  expect(managerExport.headers()["content-type"]).toContain("text/csv");
  expect(managerExport.headers()["content-disposition"]).toContain("sales-reports-");
  const managerCsv = await managerExport.text();
  expect(managerCsv).toContain('"Report date","Period","Status","Member name","Member email"');
  expect(managerCsv).toContain(records.memberEmail);
  expect(managerCsv).toContain(records.memberCustomer);
  expect(managerCsv).toContain('"\'=Danger Product"');
  expect(managerCsv).toContain('"\'@danger note"');
  expect(managerCsv).toContain('"\'-Review note"');
  expect(managerCsv).not.toContain(records.otherMemberCustomer);
  await signOut(page);

  await signIn(page, users.member);
  const memberExport = await page.context().request.get(`/reports/export?memberId=${records.otherMemberId}&status=SUBMITTED`);
  expect(memberExport.ok()).toBeTruthy();
  const memberCsv = await memberExport.text();
  expect(memberCsv).toContain('"Report date","Period","Status","Member name","Customer"');
  expect(memberCsv).not.toContain('"Member email"');
  expect(memberCsv).toContain(records.memberCustomer);
  expect(memberCsv).not.toContain(records.otherMemberCustomer);
  expect(memberCsv).not.toContain(records.otherMemberEmail);
  await signOut(page);
});

test("legacy xls files are rejected cleanly", async ({ page }) => {
  await signIn(page, users.member);
  await page.goto("/reports");
  await page.getByTestId("import-toggle").click();
  await page.getByTestId("import-file").setInputFiles({
    name: "legacy.xls",
    mimeType: "application/vnd.ms-excel",
    buffer: Buffer.from("not a supported workbook")
  });
  await page.getByTestId("import-preview").click();
  await expect(page.getByText("Legacy .xls files are no longer supported.")).toBeVisible();
});

async function signIn(page: Page, email: string) {
  await page.goto("/signin");
  await page.getByTestId("sign-in-email").fill(email);
  await page.getByTestId("sign-in-password").fill(password);
  await page.getByTestId("sign-in-submit").click();
  await expect(page).toHaveURL(/\/overview$/);
}

async function signOut(page: Page) {
  await page.getByTestId("sign-out").click();
  await expect(page).toHaveURL(/\/signin$/);
}

async function waitForReportByCustomer(customer: string, status?: SubmissionStatus) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const report = await prisma.salesReport.findFirst({
      where: {
        ...(status ? { status } : {}),
        rows: { some: { customer } }
      },
      orderBy: { updatedAt: "desc" }
    });
    if (report) return report;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Report with customer "${customer}" was not found.`);
}

async function waitForReportStatus(reportId: string, status: SubmissionStatus) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const report = await prisma.salesReport.findUnique({ where: { id: reportId } });
    if (report?.status === status) return report;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Report ${reportId} did not reach ${status}.`);
}

async function waitForRateLimitAttempts(email: string, attempts: number) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const record = await prisma.authRateLimit.findFirst({ where: { email } });
    if (record && record.attempts >= attempts) return record;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Rate-limit record for ${email} did not reach ${attempts} attempts.`);
}

async function cleanupSmokeData() {
  await prisma.salesReport.deleteMany({
    where: {
      rows: {
        some: {
          customer: { startsWith: smokeCustomerPrefix }
        }
      }
    }
  });

  await prisma.authRateLimit.deleteMany({
    where: {
      email: { startsWith: rateLimitEmailPrefix }
    }
  });
}

async function createSmokeExportRecords() {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: "northstar-sales" } });
  const period = await prisma.reportingPeriod.findFirstOrThrow({
    where: { workspaceId: workspace.id, type: "MONTHLY" },
    orderBy: { startDate: "desc" }
  });
  const [member, otherMember] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { email: users.member } }),
    prisma.user.findUniqueOrThrow({ where: { email: "devon@northstar.test" } })
  ]);
  const suffix = Date.now();
  const memberCustomer = `${smokeCustomerPrefix}${suffix} Member Export`;
  const otherMemberCustomer = `${smokeCustomerPrefix}${suffix} Other Member Export`;

  await prisma.salesReport.create({
    data: {
      workspaceId: workspace.id,
      memberId: member.id,
      periodId: period.id,
      reportDate: new Date(),
      status: "SUBMITTED",
      submittedAt: new Date(),
      notes: "-Review note",
      rows: {
        create: {
          customer: memberCustomer,
          product: "=Danger Product",
          salesAmount: 321.45,
          unitsSold: 7,
          notes: "@danger note",
          rowOrder: 0
        }
      }
    }
  });

  await prisma.salesReport.create({
    data: {
      workspaceId: workspace.id,
      memberId: otherMember.id,
      periodId: period.id,
      reportDate: new Date(),
      status: "SUBMITTED",
      submittedAt: new Date(),
      rows: {
        create: {
          customer: otherMemberCustomer,
          product: "Other Product",
          salesAmount: 654.32,
          unitsSold: 3,
          rowOrder: 0
        }
      }
    }
  });

  return {
    memberId: member.id,
    memberEmail: member.email,
    memberCustomer,
    otherMemberId: otherMember.id,
    otherMemberEmail: otherMember.email,
    otherMemberCustomer
  };
}
