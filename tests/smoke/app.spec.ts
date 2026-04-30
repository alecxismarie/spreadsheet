import { expect, test, type Page } from "@playwright/test";
import { PrismaClient, type ReportAuditAction, type SubmissionStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const password = "demo1234";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const users = {
  owner: "owner@northstar.test",
  manager: "manager@northstar.test",
  member: "maria@northstar.test"
};
const smokeCustomerPrefix = "SMOKE TEST ";
const rateLimitEmailPrefix = "smoke-rate-limit-";
const teamMemberEmailPrefix = "smoke-team-member-";
const teamInviteEmailPrefix = "smoke-team-invite-";

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

test("owner manages team lifecycle and non-admins cannot manage users", async ({ browser, page }) => {
  test.setTimeout(120_000);
  const suffix = Date.now();
  const managedEmail = `${teamMemberEmailPrefix}${suffix}@northstar.test`;
  const inviteEmail = `${teamInviteEmailPrefix}${suffix}@northstar.test`;
  const { user: managedUser, membership: managedMembership } = await createSmokeTeamMember(managedEmail);
  const initialSessionVersion = managedUser.sessionVersion;
  const memberContext = await browser.newContext({ baseURL });
  const memberPage = await memberContext.newPage();

  try {
    await signIn(memberPage, managedEmail);

    await signIn(page, users.owner);
    await page.goto("/team");
    await expect(page.getByTestId("team-invite-email")).toBeVisible();
    await expect(page.getByTestId(`team-member-row-${managedUser.id}`)).toContainText("Active");

    await page.getByTestId("team-invite-email").fill(inviteEmail);
    await page.getByTestId("team-invite-role").selectOption("MANAGER");
    await page.getByTestId("team-invite-submit").click();
    await expect(page.getByTestId("team-action-message")).toContainText(`Invite created for ${inviteEmail}.`);
    await expect(page.getByTestId("team-invite-link")).toContainText("/invite/");
    await waitForPendingInvitation(inviteEmail);
    await expect(page.getByTestId("team-pending-invite").filter({ hasText: inviteEmail })).toBeVisible();

    await page.getByTestId(`team-role-select-${managedMembership.id}`).selectOption("MANAGER");
    await page.getByTestId(`team-role-submit-${managedMembership.id}`).click();
    await expect(page.getByTestId("team-action-message")).toContainText("Member role updated.");
    await waitForMembership(managedEmail, "MANAGER", true);
    await expectSessionVersionGreaterThan(managedEmail, initialSessionVersion);

    await memberPage.goto("/overview");
    await expect(memberPage).toHaveURL(/\/signin$/);
    await signIn(memberPage, managedEmail);
    await memberPage.goto("/team");
    await expect(memberPage.getByTestId("team-invite-email")).toHaveCount(0);
    await expect(memberPage.locator("[data-testid^='team-role-submit-']")).toHaveCount(0);

    await page.goto("/team");
    await page.getByTestId(`team-deactivate-${managedMembership.id}`).click();
    await expect(page.getByTestId("team-action-message")).toContainText("Member deactivated.");
    await waitForMembership(managedEmail, "MANAGER", false);
    await expect(page.getByTestId(`team-member-row-${managedUser.id}`)).toContainText("Deactivated");

    await memberPage.goto("/overview");
    await expect(memberPage).toHaveURL(/\/signin$/);
    await memberPage.goto("/signin");
    await memberPage.getByTestId("sign-in-email").fill(managedEmail);
    await memberPage.getByTestId("sign-in-password").fill(password);
    await memberPage.getByTestId("sign-in-submit").click();
    await expect(memberPage.getByText("Invalid email or password.")).toBeVisible();

    await page.getByTestId(`team-reactivate-${managedMembership.id}`).click();
    await expect(page.getByTestId("team-action-message")).toContainText("Member reactivated.");
    await waitForMembership(managedEmail, "MANAGER", true);
    await signIn(memberPage, managedEmail);

    const ownerMembership = await getMembershipByEmail(users.owner);
    await page.getByTestId(`team-role-select-${ownerMembership.id}`).selectOption("MEMBER");
    await page.getByTestId(`team-role-submit-${ownerMembership.id}`).click();
    await expect(page.getByTestId("team-action-message")).toContainText("Cannot remove the last active owner from the workspace.");
    await waitForMembership(users.owner, "OWNER", true);

    await page.getByTestId(`team-deactivate-${ownerMembership.id}`).click();
    await expect(page.getByTestId("team-action-message")).toContainText("Cannot remove the last active owner from the workspace.");
    await waitForMembership(users.owner, "OWNER", true);

    await expectTeamAuditCount([managedEmail, inviteEmail], 3);
    await signOut(page);
  } finally {
    await memberContext.close();
  }
});

test("member report lifecycle, manager review, approval, and CSV import smoke", async ({ page }) => {
  test.setTimeout(120_000);
  const runPrefix = `${smokeCustomerPrefix}${Date.now()} `;
  const customer = `${runPrefix}Account`;
  const importCustomer = `${runPrefix}Import`;

  await signIn(page, users.member);
  await page.goto("/reports");
  await startNewReport(page);
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
  const manager = await prisma.user.findUniqueOrThrow({ where: { email: users.manager } });
  const reviewComment = await waitForReviewComment(draft.id, "Smoke review note");
  expect(reviewComment.authorId).toBe(manager.id);
  expect(reviewComment.statusContext).toBe("NEEDS_REVIEW");
  await signOut(page);

  await signIn(page, users.member);
  await page.goto("/reports");
  await page.getByTestId(`report-list-item-${draft.id}`).click();
  await expect(page.getByText("This report needs review.")).toBeVisible();
  await expect(page.getByTestId("active-review-feedback")).toContainText("Smoke review note");
  await page.getByTestId("report-row-units-0").fill("4");
  await page.getByTestId("report-submit").click();
  await waitForReportStatus(draft.id, "SUBMITTED");
  await page.goto("/reports");
  await page.getByTestId(`report-list-item-${draft.id}`).click();
  await expect(page.getByTestId("active-review-feedback")).toHaveCount(0);
  await expect(page.getByTestId("review-history-comment").filter({ hasText: "Smoke review note" })).toBeVisible();
  await signOut(page);

  await signIn(page, users.manager);
  await page.goto("/reports");
  await page.getByTestId(`report-list-item-${draft.id}`).click();
  await page.getByTestId("review-approve").click();
  await waitForReportStatus(draft.id, "APPROVED");
  await page.goto("/reports");
  await page.getByTestId(`report-list-item-${draft.id}`).click();
  await expect(page.getByTestId("active-review-feedback")).toHaveCount(0);
  await expect(page.getByTestId("review-history-comment").filter({ hasText: "Smoke review note" })).toBeVisible();
  await waitForAuditActions(draft.id, ["NEEDS_REVIEW", "RESUBMITTED", "APPROVED"]);
  await expectReviewCommentCount(draft.id, 1);
  await signOut(page);

  await signIn(page, users.member);
  const importDate = new Date().toISOString().slice(0, 10);
  const firstImportCsv = `Customer,Product,Sales Amount,Units Sold,Notes\n${importCustomer},Import Plan,99.50,2,Imported by smoke test`;
  await importCsvAsDraft(page, "smoke-import.csv", firstImportCsv, importDate);
  await expect(page.getByText("Imported 1 row into a draft report.")).toBeVisible();
  await waitForReportByCustomer(importCustomer, "DRAFT");
  await expectReportRowCount(importCustomer, 1);

  await importCsvAsDraft(page, "smoke-import.csv", firstImportCsv, importDate);
  await expect(page.getByText("Imported 0 rows into a draft report. Skipped 1 duplicate row.")).toBeVisible();
  await expect(page.getByText("Imported rows: 0. Skipped duplicates: 1.")).toBeVisible();
  await expectReportRowCount(importCustomer, 1);

  const duplicateBatchCustomer = `${runPrefix}Batch Duplicate`;
  const mixedNewCustomer = `${runPrefix}Mixed New`;
  await importCsvAsDraft(
    page,
    "smoke-import-mixed.csv",
    [
      "Customer,Product,Sales Amount,Units Sold,Notes",
      `${importCustomer},Import Plan,99.50,2,Imported by smoke test`,
      `${duplicateBatchCustomer},Batch Plan,120.00,5,Duplicate inside same file`,
      `${duplicateBatchCustomer},Batch Plan,120,5,Duplicate inside same file`,
      `${mixedNewCustomer},Mixed Plan,150.00,3,Unique mixed import`
    ].join("\n"),
    importDate
  );
  await expect(page.getByText("Imported 2 rows into a draft report. Skipped 2 duplicate rows.")).toBeVisible();
  await expect(page.getByText("Imported rows: 2. Skipped duplicates: 2.")).toBeVisible();
  await expectReportRowCount(importCustomer, 1);
  await expectReportRowCount(duplicateBatchCustomer, 1);
  await expectReportRowCount(mixedNewCustomer, 1);
  await signOut(page);
});

test("CSV export respects permissions, filters, and formula sanitization", async ({ page }) => {
  const records = await createSmokeExportRecords();
  const managerFilters = `memberId=${records.memberId}&status=SUBMITTED&from=${records.exportDate}&to=${records.exportDate}`;
  const memberFilters = `memberId=${records.otherMemberId}&status=SUBMITTED&from=${records.exportDate}&to=${records.exportDate}`;

  await signIn(page, users.manager);
  const managerExport = await page.context().request.get(`/reports/export?${managerFilters}`);
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
  expect(managerCsv).toContain('\r\n\r\n"Summary"\r\n');
  expect(managerCsv).toContain('"Total reports",1');
  expect(managerCsv).toContain('"Total rows",1');
  expect(managerCsv).toContain('"Total sales amount",321.45');
  expect(managerCsv).toContain('"Total units sold",7');
  await waitForExportAudit(users.manager, {
    filters: {
      memberId: records.memberId,
      status: "SUBMITTED",
      from: records.exportDate,
      to: records.exportDate
    },
    reportCount: 1,
    rowCount: 1
  });
  await signOut(page);

  await signIn(page, users.member);
  const memberExport = await page.context().request.get(`/reports/export?${memberFilters}`);
  expect(memberExport.ok()).toBeTruthy();
  const memberCsv = await memberExport.text();
  expect(memberCsv).toContain('"Report date","Period","Status","Member name","Customer"');
  expect(memberCsv).not.toContain('"Member email"');
  expect(memberCsv).toContain(records.memberCustomer);
  expect(memberCsv).not.toContain(records.otherMemberCustomer);
  expect(memberCsv).not.toContain(records.otherMemberEmail);
  expect(memberCsv).toContain('"Total reports",1');
  expect(memberCsv).toContain('"Total rows",1');
  expect(memberCsv).toContain('"Total sales amount",321.45');
  expect(memberCsv).toContain('"Total units sold",7');
  await waitForExportAudit(users.member, {
    filters: {
      memberId: records.memberId,
      status: "SUBMITTED",
      from: records.exportDate,
      to: records.exportDate
    },
    reportCount: 1,
    rowCount: 1
  });
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

async function importCsvAsDraft(page: Page, filename: string, csv: string, reportDate: string) {
  await page.goto("/reports");
  await page.getByTestId("import-toggle").click();
  await page.getByTestId("import-file").setInputFiles({
    name: filename,
    mimeType: "text/csv",
    buffer: Buffer.from(csv)
  });
  await page.getByTestId("import-preview").click();
  const parsedRows = csv.split("\n").length - 1;
  await expect(page.getByText(`Parsed ${parsedRows} row${parsedRows === 1 ? "" : "s"}.`, { exact: true })).toBeVisible();
  await page.getByTestId("import-date-input").fill(reportDate);
  await page.getByTestId("import-submit").click();
}

async function startNewReport(page: Page) {
  await expect(async () => {
    await page.getByTestId("report-new").click();
    await expect(page.getByTestId("report-row-customer-0")).toBeEnabled({ timeout: 1000 });
  }).toPass();
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

async function expectReportRowCount(customer: string, count: number) {
  await expect.poll(() => prisma.salesReportRow.count({ where: { customer } })).toBe(count);
}

async function waitForReportStatus(reportId: string, status: SubmissionStatus) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const report = await prisma.salesReport.findUnique({ where: { id: reportId } });
    if (report?.status === status) return report;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Report ${reportId} did not reach ${status}.`);
}

async function waitForReviewComment(reportId: string, body: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const comment = await prisma.reportReviewComment.findFirst({
      where: { reportId, body },
      orderBy: { createdAt: "desc" }
    });
    if (comment) return comment;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Review comment "${body}" was not found for report ${reportId}.`);
}

async function waitForAuditActions(reportId: string, actions: ReportAuditAction[]) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const logs = await prisma.reportAuditLog.findMany({
      where: { reportId, action: { in: actions } },
      select: { action: true }
    });
    const found = new Set(logs.map((log) => log.action));
    if (actions.every((action) => found.has(action))) return logs;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Audit actions ${actions.join(", ")} were not found for report ${reportId}.`);
}

async function expectReviewCommentCount(reportId: string, count: number) {
  await expect.poll(() => prisma.reportReviewComment.count({ where: { reportId } })).toBe(count);
}

async function waitForRateLimitAttempts(email: string, attempts: number) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const record = await prisma.authRateLimit.findFirst({ where: { email } });
    if (record && record.attempts >= attempts) return record;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Rate-limit record for ${email} did not reach ${attempts} attempts.`);
}

async function createSmokeTeamMember(email: string) {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: "northstar-sales" } });
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name: "Smoke Team Member",
      passwordHash,
      sessionVersion: 1
    },
    create: {
      email,
      name: "Smoke Team Member",
      passwordHash,
      sessionVersion: 1
    }
  });
  const membership = await prisma.membership.upsert({
    where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
    update: { role: "MEMBER", active: true },
    create: { userId: user.id, workspaceId: workspace.id, role: "MEMBER", active: true }
  });

  return { user, membership };
}

async function getMembershipByEmail(email: string) {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: "northstar-sales" } });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return prisma.membership.findUniqueOrThrow({
    where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } }
  });
}

async function waitForMembership(email: string, role: string, active: boolean) {
  await expect
    .poll(async () => {
      const membership = await getMembershipByEmail(email);
      return `${membership.role}:${membership.active}`;
    })
    .toBe(`${role}:${active}`);
}

async function waitForPendingInvitation(email: string) {
  await expect
    .poll(() =>
      prisma.workspaceInvitation.count({
        where: { email, status: "PENDING" }
      })
    )
    .toBe(1);
}

async function expectSessionVersionGreaterThan(email: string, version: number) {
  await expect
    .poll(async () => {
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      return user.sessionVersion;
    })
    .toBeGreaterThan(version);
}

async function expectTeamAuditCount(emails: string[], minimumCount: number) {
  await expect
    .poll(() =>
      prisma.teamAuditLog.count({
        where: { targetEmail: { in: emails } }
      })
    )
    .toBeGreaterThanOrEqual(minimumCount);
}

async function waitForExportAudit(
  actorEmail: string,
  expected: {
    filters: Record<string, string>;
    reportCount: number;
    rowCount: number;
  }
) {
  const actor = await prisma.user.findUniqueOrThrow({ where: { email: actorEmail } });
  await expect
    .poll(async () => {
      const logs = await prisma.workspaceExportAuditLog.findMany({
        where: {
          actorId: actor.id,
          format: "CSV",
          reportCount: expected.reportCount,
          rowCount: expected.rowCount
        },
        orderBy: { createdAt: "desc" },
        take: 10
      });

      return logs.some((log) => {
        try {
          const filters = JSON.parse(log.filtersJson) as Record<string, string>;
          return Object.entries(expected.filters).every(([key, value]) => filters[key] === value);
        } catch {
          return false;
        }
      });
    })
    .toBe(true);
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
      OR: [
        { email: { startsWith: rateLimitEmailPrefix } },
        { email: { startsWith: teamMemberEmailPrefix } }
      ]
    }
  });

  await prisma.workspaceInvitation.deleteMany({
    where: {
      OR: [
        { email: { startsWith: teamMemberEmailPrefix } },
        { email: { startsWith: teamInviteEmailPrefix } }
      ]
    }
  });

  await prisma.teamAuditLog.deleteMany({
    where: {
      OR: [
        { targetEmail: { startsWith: teamMemberEmailPrefix } },
        { targetEmail: { startsWith: teamInviteEmailPrefix } }
      ]
    }
  });

  await prisma.user.deleteMany({
    where: {
      OR: [
        { email: { startsWith: teamMemberEmailPrefix } },
        { email: { startsWith: teamInviteEmailPrefix } }
      ]
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
  const reportDate = new Date("2099-01-15T12:00:00.000Z");
  const exportDate = "2099-01-15";
  const memberCustomer = `${smokeCustomerPrefix}${suffix} Member Export`;
  const otherMemberCustomer = `${smokeCustomerPrefix}${suffix} Other Member Export`;

  await prisma.salesReport.create({
    data: {
      workspaceId: workspace.id,
      memberId: member.id,
      periodId: period.id,
      reportDate,
      status: "SUBMITTED",
      submittedAt: reportDate,
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
      reportDate,
      status: "SUBMITTED",
      submittedAt: reportDate,
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
    otherMemberCustomer,
    exportDate
  };
}
