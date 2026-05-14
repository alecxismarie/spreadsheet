import { expect, test, type Page } from "@playwright/test";
import { PrismaClient, type ReportAuditAction, type SubmissionStatus, type TeamAuditAction } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";

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
const workspaceLifecycleEmailPrefix = "smoke-workspace-lifecycle-";
const workspaceLifecycleSlugPrefix = "smoke-workspace-lifecycle-";
const passwordResetEmailPrefix = "smoke-reset-user-";
const invitePassword = "invite1234";
const passwordResetGenericMessage = "If an account exists for that email, a reset link has been created/sent.";
const noActiveWorkspaceMessage = "No active workspace is available for this account. Contact your workspace owner.";

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

test("workspace lifecycle requires an active workspace membership", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = Date.now();
  const passwordHash = await bcrypt.hash(password, 10);
  const noWorkspaceEmail = `${workspaceLifecycleEmailPrefix}${suffix}-none@northstar.test`;
  const inactiveEmail = `${workspaceLifecycleEmailPrefix}${suffix}-inactive@northstar.test`;
  const activeEmail = `${workspaceLifecycleEmailPrefix}${suffix}-active@northstar.test`;
  const inactiveWorkspace = await prisma.workspace.create({
    data: {
      name: "Smoke Inactive Workspace",
      slug: `${workspaceLifecycleSlugPrefix}${suffix}-inactive`,
      active: false
    }
  });
  const activeWorkspace = await prisma.workspace.create({
    data: {
      name: "Smoke Active Workspace",
      slug: `${workspaceLifecycleSlugPrefix}${suffix}-active`,
      active: true
    }
  });

  await prisma.user.create({
    data: {
      email: noWorkspaceEmail,
      name: "Smoke No Workspace",
      passwordHash
    }
  });
  const inactiveUser = await prisma.user.create({
    data: {
      email: inactiveEmail,
      name: "Smoke Inactive Workspace User",
      passwordHash
    }
  });
  const activeUser = await prisma.user.create({
    data: {
      email: activeEmail,
      name: "Smoke Active Workspace User",
      passwordHash
    }
  });
  await prisma.membership.create({
    data: {
      userId: inactiveUser.id,
      workspaceId: inactiveWorkspace.id,
      role: "OWNER",
      active: true
    }
  });
  await prisma.membership.create({
    data: {
      userId: activeUser.id,
      workspaceId: activeWorkspace.id,
      role: "OWNER",
      active: true
    }
  });

  await expectSignInError(page, noWorkspaceEmail, password, noActiveWorkspaceMessage);
  await expectSignInError(page, inactiveEmail, password, noActiveWorkspaceMessage);

  await signIn(page, activeEmail);
  await prisma.workspace.update({
    where: { id: activeWorkspace.id },
    data: { active: false }
  });
  await page.goto("/overview");
  await expect(page).toHaveURL(/\/signin\?workspace=inactive$/);
  await expect(page.getByTestId("workspace-unavailable-message")).toContainText(
    "No active workspace is available for this session."
  );
});

test("multi-workspace sign-in selects the earliest active membership deterministically", async ({ page }) => {
  const suffix = Date.now();
  const email = `${workspaceLifecycleEmailPrefix}${suffix}-multi@northstar.test`;
  const passwordHash = await bcrypt.hash(password, 10);
  const primaryName = `Smoke Primary Workspace ${suffix}`;
  const secondaryName = `Smoke Secondary Workspace ${suffix}`;
  const [primaryWorkspace, secondaryWorkspace] = await Promise.all([
    prisma.workspace.create({
      data: {
        name: primaryName,
        slug: `${workspaceLifecycleSlugPrefix}${suffix}-primary`,
        active: true
      }
    }),
    prisma.workspace.create({
      data: {
        name: secondaryName,
        slug: `${workspaceLifecycleSlugPrefix}${suffix}-secondary`,
        active: true
      }
    })
  ]);
  const user = await prisma.user.create({
    data: {
      email,
      name: "Smoke Multi Workspace User",
      passwordHash
    }
  });

  await prisma.membership.create({
    data: {
      userId: user.id,
      workspaceId: secondaryWorkspace.id,
      role: "MEMBER",
      active: true,
      createdAt: new Date("2026-01-02T00:00:00.000Z")
    }
  });
  await prisma.membership.create({
    data: {
      userId: user.id,
      workspaceId: primaryWorkspace.id,
      role: "OWNER",
      active: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z")
    }
  });

  await signIn(page, email);
  await expect(page.getByRole("heading", { name: primaryName })).toBeVisible();
  await expect(page.getByText(secondaryName)).toHaveCount(0);
  await signOut(page);
});

test("overview labels target comparisons as full-period when date filters are partial", async ({ page }) => {
  await signIn(page, users.owner);
  await page.goto("/overview?from=2099-01-01&to=2099-01-15");
  await expect(page.getByTestId("target-scope-note")).toContainText(
    "Targets use full overlapping reporting periods for selected dates."
  );
  await expect(page.getByText("Target progress (full period)")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Target (full period)" })).toBeVisible();
  await signOut(page);
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
    const firstInvite = await prisma.workspaceInvitation.findFirstOrThrow({
      where: { email: inviteEmail, status: "PENDING" },
      orderBy: { createdAt: "desc" }
    });
    await expect(page.getByTestId("team-pending-invite").filter({ hasText: inviteEmail })).toBeVisible();

    await page.getByTestId("team-invite-email").fill(inviteEmail);
    await page.getByTestId("team-invite-role").selectOption("MEMBER");
    await page.getByTestId("team-invite-submit").click();
    await expect(page.getByTestId("team-action-message")).toContainText(`Invite created for ${inviteEmail}.`);
    await expectInvitationStatus(firstInvite.id, "REVOKED");
    await expect
      .poll(() =>
        prisma.workspaceInvitation.count({
          where: { email: inviteEmail, status: "PENDING", expiresAt: { gt: new Date() } }
        })
      )
      .toBe(1);
    await expect(page.getByTestId("team-pending-invite").filter({ hasText: inviteEmail })).toHaveCount(1);

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
    await expect(memberPage).toHaveURL(/\/signin\?workspace=inactive$/);
    await expect(memberPage.getByTestId("workspace-unavailable-message")).toContainText(
      "No active workspace is available for this session."
    );
    await memberPage.goto("/signin");
    await memberPage.getByTestId("sign-in-email").fill(managedEmail);
    await memberPage.getByTestId("sign-in-password").fill(password);
    await memberPage.getByTestId("sign-in-submit").click();
    await expect(memberPage.getByText(noActiveWorkspaceMessage)).toBeVisible();

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

    await expectTeamAuditCount([managedEmail, inviteEmail], 5);
    await signOut(page);
  } finally {
    await memberContext.close();
  }
});

test("invite acceptance creates a new user, signs in, audits, and blocks reuse", async ({ page }) => {
  const suffix = Date.now();
  const email = `${teamInviteEmailPrefix}${suffix}@northstar.test`;
  const invite = await createWorkspaceInvite(email, "MEMBER");

  await page.goto(`/invite/${invite.token}`);
  await expect(page.getByTestId("invite-workspace")).toContainText("Northstar Sales");
  await expect(page.getByTestId("invite-email")).toContainText(email);
  await expect(page.getByTestId("invite-role")).toContainText("MEMBER");
  await page.getByTestId("invite-password").fill(invitePassword);
  await page.getByTestId("invite-confirm-password").fill(invitePassword);
  await page.getByTestId("invite-accept-submit").click();
  await expect(page).toHaveURL(/\/overview$/);

  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const membership = await getMembershipByEmail(email);
  const acceptedInvite = await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: invite.inviteId } });
  expect(membership.active).toBe(true);
  expect(membership.role).toBe("MEMBER");
  expect(acceptedInvite.status).toBe("ACCEPTED");
  expect(acceptedInvite.acceptedAt).not.toBeNull();
  expect(await bcrypt.compare(invitePassword, user.passwordHash)).toBeTruthy();
  await expectTeamAuditAction(email, "INVITE_ACCEPTED");

  await signOut(page);
  await signInWithPassword(page, email, invitePassword);
  await signOut(page);

  await page.goto(`/invite/${invite.token}`);
  await expect(page.getByTestId("invite-state-message")).toContainText("This invite has already been accepted.");
});

test("invite acceptance handles existing users and rejects unavailable invites", async ({ page }) => {
  const suffix = Date.now();
  const existingEmail = `${teamInviteEmailPrefix}${suffix}-existing@northstar.test`;
  const existingPassword = "existing1234";
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: "northstar-sales" } });
  const passwordHash = await bcrypt.hash(existingPassword, 10);
  const existingUser = await prisma.user.create({
    data: {
      email: existingEmail,
      name: "Existing Invite User",
      passwordHash
    }
  });
  await prisma.membership.create({
    data: {
      userId: existingUser.id,
      workspaceId: workspace.id,
      role: "MEMBER",
      active: false
    }
  });
  const existingInvite = await createWorkspaceInvite(existingEmail, "MANAGER");

  await page.goto(`/invite/${existingInvite.token}`);
  await expect(page.getByText("This email already has an account.")).toBeVisible();
  await page.getByTestId("invite-password").fill(existingPassword);
  await page.getByTestId("invite-confirm-password").fill(existingPassword);
  await page.getByTestId("invite-accept-submit").click();
  await expect(page).toHaveURL(/\/overview$/);

  const updatedUser = await prisma.user.findUniqueOrThrow({ where: { email: existingEmail } });
  const acceptedInvite = await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: existingInvite.inviteId } });
  expect(updatedUser.name).toBe("Existing Invite User");
  expect(updatedUser.sessionVersion).toBeGreaterThan(existingUser.sessionVersion);
  expect(await bcrypt.compare(existingPassword, updatedUser.passwordHash)).toBeTruthy();
  await waitForMembership(existingEmail, "MANAGER", true);
  expect(acceptedInvite.status).toBe("ACCEPTED");
  expect(acceptedInvite.acceptedAt).not.toBeNull();
  await expectTeamAuditAction(existingEmail, "INVITE_ACCEPTED");
  await signOut(page);

  const expiredInvite = await createWorkspaceInvite(`${teamInviteEmailPrefix}${suffix}-expired@northstar.test`, "MEMBER", {
    expiresAt: new Date(Date.now() - 60_000)
  });
  await page.goto(`/invite/${expiredInvite.token}`);
  await expect(page.getByTestId("invite-state-message")).toContainText("This invite has expired.");
  await expectInvitationStatus(expiredInvite.inviteId, "EXPIRED");

  const revokedInvite = await createWorkspaceInvite(`${teamInviteEmailPrefix}${suffix}-revoked@northstar.test`, "MEMBER", {
    status: "REVOKED"
  });
  await page.goto(`/invite/${revokedInvite.token}`);
  await expect(page.getByTestId("invite-state-message")).toContainText("This invite has been revoked.");

  await page.goto(`/invite/${randomBytes(32).toString("base64url")}`);
  await expect(page.getByTestId("invite-state-message")).toContainText("This invite link is invalid.");
});

test("team pending invites expire stale rows and keep only current invites visible", async ({ page }) => {
  const suffix = Date.now();
  const expiredEmail = `${teamInviteEmailPrefix}${suffix}-stale@northstar.test`;
  const activeEmail = `${teamInviteEmailPrefix}${suffix}-current@northstar.test`;
  const expiredInvite = await createWorkspaceInvite(expiredEmail, "MEMBER", {
    expiresAt: new Date(Date.now() - 60_000)
  });
  await createWorkspaceInvite(activeEmail, "MANAGER");

  await signIn(page, users.owner);
  await page.goto("/team");
  await expectInvitationStatus(expiredInvite.inviteId, "EXPIRED");
  await expect(page.getByTestId("team-pending-invite").filter({ hasText: expiredEmail })).toHaveCount(0);
  await expect(page.getByTestId("team-pending-invite").filter({ hasText: activeEmail })).toHaveCount(1);
  await signOut(page);
});

test("password reset request and completion are generic, single-use, and invalidate old sessions", async ({ page }) => {
  const suffix = Date.now();
  const email = `${passwordResetEmailPrefix}${suffix}@northstar.test`;
  const unknownEmail = `${passwordResetEmailPrefix}${suffix}-unknown@northstar.test`;
  const oldPassword = "oldreset1234";
  const newPassword = "newreset1234";
  const { user } = await createSmokeTeamMember(email, oldPassword);

  await page.goto("/signin");
  await page.getByTestId("forgot-password-link").click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await page.getByTestId("forgot-email").fill(email);
  await page.getByTestId("forgot-submit").click();
  await expect(page.getByTestId("forgot-message")).toContainText(passwordResetGenericMessage);
  const resetHref = await page.getByTestId("forgot-reset-link").getAttribute("href");
  expect(resetHref).toBeTruthy();
  const resetTokenValue = tokenFromResetHref(resetHref!);
  const resetToken = await waitForPasswordResetToken(email);
  expect(resetToken.tokenHash).toBe(hashPasswordResetToken(resetTokenValue));
  expect(resetToken.tokenHash).not.toBe(resetTokenValue);
  expect(resetToken.expiresAt.getTime()).toBeGreaterThan(Date.now());
  expect(resetToken.usedAt).toBeNull();

  await page.goto("/forgot-password");
  await page.getByTestId("forgot-email").fill(unknownEmail);
  await page.getByTestId("forgot-submit").click();
  await expect(page.getByTestId("forgot-message")).toContainText(passwordResetGenericMessage);
  await expect(page.getByTestId("forgot-reset-link")).toHaveCount(0);
  await expect.poll(() => prisma.passwordResetToken.count({ where: { user: { email: unknownEmail } } })).toBe(0);

  const expiredTokenValue = randomBytes(32).toString("base64url");
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashPasswordResetToken(expiredTokenValue),
      expiresAt: new Date(Date.now() - 60_000)
    }
  });
  await page.goto(`/reset-password/${expiredTokenValue}`);
  await expect(page.getByTestId("reset-state-message")).toContainText("This reset link has expired.");

  await page.goto(resetHref!);
  await page.getByTestId("reset-password").fill(newPassword);
  await page.getByTestId("reset-confirm-password").fill(newPassword);
  await page.getByTestId("reset-submit").click();
  await expect(page).toHaveURL(/\/signin\?reset=success$/);
  await expect(page.getByTestId("reset-success-message")).toBeVisible();

  const usedToken = await prisma.passwordResetToken.findUniqueOrThrow({ where: { id: resetToken.id } });
  const updatedUser = await prisma.user.findUniqueOrThrow({ where: { email } });
  expect(usedToken.usedAt).not.toBeNull();
  expect(updatedUser.sessionVersion).toBeGreaterThan(user.sessionVersion);
  expect(await bcrypt.compare(newPassword, updatedUser.passwordHash)).toBeTruthy();

  await page.goto(resetHref!);
  await expect(page.getByTestId("reset-state-message")).toContainText("This reset link has already been used.");

  await expectSignInFails(page, email, oldPassword);
  await signInWithPassword(page, email, newPassword);
  await signOut(page);
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
  const importDraft = await waitForReportByCustomer(importCustomer, "DRAFT");
  await expectReportRowCount(importCustomer, 1);

  await importCsvAsDraft(page, "smoke-import.csv", firstImportCsv, importDate);
  await expect(page.getByText("Imported 0 rows into a draft report. Skipped 1 duplicate row.")).toBeVisible();
  await expect(page.getByText("Imported rows: 0. Skipped duplicates: 1.")).toBeVisible();
  await expectReportCountForKey(importDraft.id, 1);
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

test("report uniqueness reuses draft reports and blocks submitted or approved duplicates", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = Date.now();
  const draftDate = futureDate(suffix, 1);
  const submittedDate = futureDate(suffix, 2);
  const draft = await createSmokeReportForEmail(users.member, "DRAFT", draftDate, `${smokeCustomerPrefix}${suffix} Existing Draft`);
  const replacementCustomer = `${smokeCustomerPrefix}${suffix} Draft Replacement`;

  await signIn(page, users.member);
  await attemptManualReport(page, draft.period.id, draftDate, replacementCustomer);
  await expect(page.getByText("Changes saved.")).toBeVisible();
  await expectReportCountForKey(draft.report.id, 1);
  await expect.poll(() => prisma.salesReportRow.count({ where: { reportId: draft.report.id, customer: replacementCustomer } })).toBe(1);

  const submitted = await createSmokeReportForEmail(users.member, "SUBMITTED", submittedDate, `${smokeCustomerPrefix}${suffix} Submitted Original`);
  await attemptManualReport(page, submitted.period.id, submittedDate, `${smokeCustomerPrefix}${suffix} Submitted Duplicate`);
  await expect(page.getByText("A report already exists for this member, period, and date.")).toBeVisible();
  await expectReportCountForKey(submitted.report.id, 1);
  await signOut(page);

  await signIn(page, users.manager);
  await page.goto("/reports");
  await page.getByTestId(`report-list-item-${submitted.report.id}`).click();
  await page.getByTestId("review-approve").click();
  await waitForReportStatus(submitted.report.id, "APPROVED");
  await signOut(page);

  await signIn(page, users.member);
  await attemptManualReport(page, submitted.period.id, submittedDate, `${smokeCustomerPrefix}${suffix} Approved Duplicate`);
  await expect(page.getByText("A report already exists for this member, period, and date.")).toBeVisible();
  await expectReportCountForKey(submitted.report.id, 1);
});

test("review governance blocks self-approval and preserves manager review for other members", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = Date.now();
  const managerReport = await createSmokeReportForEmail(users.manager, "SUBMITTED", futureDate(suffix, 3), `${smokeCustomerPrefix}${suffix} Manager Own`);
  const memberReport = await createSmokeReportForEmail(users.member, "SUBMITTED", futureDate(suffix, 4), `${smokeCustomerPrefix}${suffix} Member Other`);

  await signIn(page, users.manager);
  await page.goto("/reports");
  await page.getByTestId(`report-list-item-${managerReport.report.id}`).click();
  await expect(page.getByTestId("review-approve")).toHaveCount(0);
  await expect(page.getByTestId("review-needs-review")).toHaveCount(0);

  await page.getByTestId(`report-list-item-${memberReport.report.id}`).click();
  await expect(page.getByTestId("review-approve")).toBeVisible();
  const reviewForm = page.locator("form").filter({ has: page.getByTestId("review-approve") });
  await reviewForm.locator('input[name="reportId"]').evaluate((input, reportId) => {
    (input as HTMLInputElement).value = reportId;
  }, managerReport.report.id);
  await page.getByTestId("review-approve").click();
  await expect(page.getByText("You cannot review your own report.")).toBeVisible();
  await waitForReportStatus(managerReport.report.id, "SUBMITTED");
  await expect.poll(() => prisma.reportAuditLog.count({ where: { reportId: managerReport.report.id, action: "APPROVED" } })).toBe(0);
  await expectReviewCommentCount(managerReport.report.id, 0);

  await page.goto("/reports");
  await page.getByTestId(`report-list-item-${memberReport.report.id}`).click();
  await page.getByTestId("review-approve").click();
  await waitForReportStatus(memberReport.report.id, "APPROVED");
  await signOut(page);

  await signIn(page, users.member);
  await page.goto("/reports");
  await page.getByTestId(`report-list-item-${memberReport.report.id}`).click();
  await expect(page.getByTestId("review-approve")).toHaveCount(0);
  await expect(page.getByTestId("review-needs-review")).toHaveCount(0);
});

async function signIn(page: Page, email: string) {
  await signInWithPassword(page, email, password);
}

async function signInWithPassword(page: Page, email: string, signInPassword: string) {
  await page.goto("/signin");
  await page.getByTestId("sign-in-email").fill(email);
  await page.getByTestId("sign-in-password").fill(signInPassword);
  await page.getByTestId("sign-in-submit").click();
  await expect(page).toHaveURL(/\/overview$/);
}

async function expectSignInFails(page: Page, email: string, signInPassword: string) {
  await expectSignInError(page, email, signInPassword, "Invalid email or password.");
}

async function expectSignInError(page: Page, email: string, signInPassword: string, message: string) {
  await page.goto("/signin");
  await page.getByTestId("sign-in-email").fill(email);
  await page.getByTestId("sign-in-password").fill(signInPassword);
  await page.getByTestId("sign-in-submit").click();
  await expect(page.getByText(message)).toBeVisible();
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

async function attemptManualReport(page: Page, periodId: string, reportDate: string, customer: string) {
  await page.goto("/reports");
  await startNewReport(page);
  await page.getByTestId("report-period-select").selectOption(periodId);
  await page.getByTestId("report-date-input").fill(reportDate);
  await page.getByTestId("report-row-customer-0").fill(customer);
  await page.getByTestId("report-row-product-0").fill("Integrity Plan");
  await page.getByTestId("report-row-sales-0").fill("250.00");
  await page.getByTestId("report-row-units-0").fill("2");
  await page.getByTestId("report-save-draft").click();
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

async function expectReportCountForKey(reportId: string, count: number) {
  const report = await prisma.salesReport.findUniqueOrThrow({ where: { id: reportId } });
  await expect
    .poll(() =>
      prisma.salesReport.count({
        where: {
          workspaceId: report.workspaceId,
          memberId: report.memberId,
          periodId: report.periodId,
          reportDate: report.reportDate
        }
      })
    )
    .toBe(count);
}

async function waitForRateLimitAttempts(email: string, attempts: number) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const record = await prisma.authRateLimit.findFirst({ where: { email } });
    if (record && record.attempts >= attempts) return record;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Rate-limit record for ${email} did not reach ${attempts} attempts.`);
}

async function createSmokeTeamMember(email: string, memberPassword = password) {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: "northstar-sales" } });
  const passwordHash = await bcrypt.hash(memberPassword, 10);
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

async function createSmokeReportForEmail(email: string, status: SubmissionStatus, reportDateInput: string, customer: string) {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: "northstar-sales" } });
  const [user, period] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { email } }),
    prisma.reportingPeriod.findFirstOrThrow({
      where: { workspaceId: workspace.id, type: "MONTHLY" },
      orderBy: { startDate: "desc" }
    })
  ]);
  const reportDate = dateFromInput(reportDateInput);
  const report = await prisma.salesReport.create({
    data: {
      workspaceId: workspace.id,
      memberId: user.id,
      periodId: period.id,
      reportDate,
      status,
      submittedAt: status === "DRAFT" ? null : reportDate,
      reviewedAt: status === "APPROVED" ? reportDate : null,
      rows: {
        create: {
          customer,
          product: "Integrity Plan",
          salesAmount: 250,
          unitsSold: 2,
          rowOrder: 0
        }
      }
    }
  });

  return { report, period, user };
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

async function expectTeamAuditAction(email: string, action: TeamAuditAction) {
  await expect
    .poll(() =>
      prisma.teamAuditLog.count({
        where: {
          targetEmail: email,
          action
        }
      })
    )
    .toBeGreaterThanOrEqual(1);
}

async function expectInvitationStatus(inviteId: string, status: "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED") {
  await expect
    .poll(async () => {
      const invite = await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: inviteId } });
      return invite.status;
    })
    .toBe(status);
}

async function createWorkspaceInvite(
  email: string,
  role: "OWNER" | "MANAGER" | "MEMBER",
  options: { status?: "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED"; expiresAt?: Date } = {}
) {
  const [workspace, owner] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { slug: "northstar-sales" } }),
    prisma.user.findUniqueOrThrow({ where: { email: users.owner } })
  ]);
  const token = randomBytes(32).toString("base64url");
  const invite = await prisma.workspaceInvitation.create({
    data: {
      workspaceId: workspace.id,
      email,
      role,
      tokenHash: hashInviteToken(token),
      status: options.status ?? "PENDING",
      invitedById: owner.id,
      expiresAt: options.expiresAt ?? new Date(Date.now() + 1000 * 60 * 60),
      acceptedAt: options.status === "ACCEPTED" ? new Date() : null
    }
  });

  return {
    token,
    inviteId: invite.id
  };
}

function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function hashPasswordResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function tokenFromResetHref(href: string) {
  const url = new URL(href, baseURL);
  const token = url.pathname.split("/").pop();
  if (!token) throw new Error(`Could not read reset token from ${href}.`);
  return token;
}

function futureDate(seed: number, offset: number) {
  const day = ((seed + offset) % 20) + 1;
  return `2099-02-${String(day).padStart(2, "0")}`;
}

function dateFromInput(value: string) {
  return new Date(`${value}T00:00:00.000`);
}

async function waitForPasswordResetToken(email: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const token = await prisma.passwordResetToken.findFirst({
      where: { user: { email } },
      orderBy: { createdAt: "desc" }
    });
    if (token) return token;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Password reset token for ${email} was not created.`);
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

  await prisma.workspace.deleteMany({
    where: {
      slug: { startsWith: workspaceLifecycleSlugPrefix }
    }
  });

  await prisma.authRateLimit.deleteMany({
    where: {
      OR: [
        { email: { startsWith: rateLimitEmailPrefix } },
        { email: { startsWith: teamMemberEmailPrefix } },
        { email: { startsWith: teamInviteEmailPrefix } },
        { email: { startsWith: workspaceLifecycleEmailPrefix } },
        { email: { startsWith: passwordResetEmailPrefix } },
        { email: "password-reset-token" }
      ]
    }
  });

  await prisma.workspaceInvitation.deleteMany({
    where: {
      OR: [
        { email: { startsWith: teamMemberEmailPrefix } },
        { email: { startsWith: teamInviteEmailPrefix } },
        { email: { startsWith: workspaceLifecycleEmailPrefix } },
        { email: { startsWith: passwordResetEmailPrefix } }
      ]
    }
  });

  await prisma.teamAuditLog.deleteMany({
    where: {
      OR: [
        { targetEmail: { startsWith: teamMemberEmailPrefix } },
        { targetEmail: { startsWith: teamInviteEmailPrefix } },
        { targetEmail: { startsWith: workspaceLifecycleEmailPrefix } },
        { targetEmail: { startsWith: passwordResetEmailPrefix } }
      ]
    }
  });

  await prisma.user.deleteMany({
    where: {
      OR: [
        { email: { startsWith: teamMemberEmailPrefix } },
        { email: { startsWith: teamInviteEmailPrefix } },
        { email: { startsWith: workspaceLifecycleEmailPrefix } },
        { email: { startsWith: passwordResetEmailPrefix } }
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
