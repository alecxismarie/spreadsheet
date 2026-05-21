import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { slugifyWorkspaceName } from "@/lib/domain/workspace";

const prisma = new PrismaClient();
const password = "signup1234";
const signupEmailPrefix = "smoke-signup-";
const signupSlugPrefix = "smoke-signup-";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await cleanupSignupData();
});

test.afterAll(async () => {
  await cleanupSignupData();
  await prisma.$disconnect();
});

test("workspace signup creates a clean active workspace, owner membership, session, and default period", async ({ page }) => {
  const suffix = Date.now();
  const workspaceName = `Smoke Signup Workspace ${suffix}`;
  const ownerName = "Smoke Signup Owner";
  const email = `${signupEmailPrefix}${suffix}@northstar.test`;

  await submitSignup(page, { workspaceName, ownerName, email, password, confirmPassword: password });
  await expect(page).toHaveURL(/\/team$/);
  await expect(page.getByRole("heading", { name: workspaceName })).toBeVisible();
  await expect(page.getByTestId("team-invite-email")).toBeVisible();

  const workspace = await prisma.workspace.findFirstOrThrow({
    where: {
      name: workspaceName,
      memberships: { some: { user: { email } } }
    },
    include: {
      memberships: { include: { user: true } },
      periods: true,
      reports: true,
      targets: true,
      invitations: true,
      teamAuditLogs: true
    }
  });

  expect(workspace.active).toBe(true);
  expect(workspace.slug).toBe(slugifyWorkspaceName(workspaceName));
  expect(workspace.memberships).toHaveLength(1);
  expect(workspace.memberships[0].active).toBe(true);
  expect(workspace.memberships[0].role).toBe("OWNER");
  expect(workspace.memberships[0].user.email).toBe(email);
  expect(workspace.memberships[0].user.name).toBe(ownerName);
  expect(await bcrypt.compare(password, workspace.memberships[0].user.passwordHash)).toBe(true);
  expect(workspace.periods).toHaveLength(1);
  expect(workspace.periods[0].type).toBe("MONTHLY");
  expect(workspace.periods[0].startDate.getDate()).toBe(1);
  expect(workspace.reports).toHaveLength(0);
  expect(workspace.targets).toHaveLength(0);
  expect(workspace.invitations).toHaveLength(0);
  expect(workspace.teamAuditLogs).toHaveLength(0);

  await page.goto("/signup");
  await expect(page).toHaveURL(/\/overview$/);
});

test("workspace signup rejects duplicate email", async ({ page }) => {
  const suffix = Date.now();
  const email = `${signupEmailPrefix}${suffix}-duplicate@northstar.test`;
  await prisma.user.create({
    data: {
      email,
      name: "Duplicate Signup User",
      passwordHash: await bcrypt.hash(password, 10)
    }
  });

  await submitSignup(page, {
    workspaceName: `Smoke Signup Duplicate ${suffix}`,
    ownerName: "Duplicate Signup User",
    email,
    password,
    confirmPassword: password
  });

  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByTestId("signup-message")).toContainText("An account already exists for this email.");
  await expect(prisma.workspace.count({ where: { name: `Smoke Signup Duplicate ${suffix}` } })).resolves.toBe(0);
});

test("workspace signup validates password confirmation and password length", async ({ page }) => {
  const suffix = Date.now();

  await submitSignup(page, {
    workspaceName: `Smoke Signup Mismatch ${suffix}`,
    ownerName: "Mismatch Signup User",
    email: `${signupEmailPrefix}${suffix}-mismatch@northstar.test`,
    password,
    confirmPassword: "different1234"
  });
  await expect(page.getByTestId("signup-field-error")).toContainText("Passwords do not match.");

  await submitSignup(
    page,
    {
      workspaceName: `Smoke Signup Short ${suffix}`,
      ownerName: "Short Signup User",
      email: `${signupEmailPrefix}${suffix}-short@northstar.test`,
      password: "short",
      confirmPassword: "short"
    },
    { noValidate: true }
  );
  await expect(page.getByTestId("signup-field-error")).toContainText("Password must be at least 8 characters.");
});

test("workspace signup handles slug collisions safely", async ({ page }) => {
  const suffix = Date.now();
  const workspaceName = `Smoke Signup Collision ${suffix}`;
  const baseSlug = slugifyWorkspaceName(workspaceName);
  const email = `${signupEmailPrefix}${suffix}-collision@northstar.test`;

  await prisma.workspace.create({
    data: {
      name: `${workspaceName} Existing`,
      slug: baseSlug,
      active: true
    }
  });

  await submitSignup(page, { workspaceName, ownerName: "Collision Signup User", email, password, confirmPassword: password });
  await expect(page).toHaveURL(/\/team$/);

  const workspace = await prisma.workspace.findFirstOrThrow({
    where: {
      memberships: { some: { user: { email } } }
    }
  });
  expect(workspace.slug).toBe(`${baseSlug}-2`);
});

test("workspace signup rate limiting blocks repeated attempts for the same email and IP", async ({ page }) => {
  const suffix = Date.now();
  const email = `${signupEmailPrefix}${suffix}-limited@northstar.test`;
  await prisma.user.create({
    data: {
      email,
      name: "Rate Limited Signup User",
      passwordHash: await bcrypt.hash(password, 10)
    }
  });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await submitSignup(page, {
      workspaceName: `Smoke Signup Limited ${suffix}`,
      ownerName: "Rate Limited Signup User",
      email,
      password,
      confirmPassword: password
    });
    await expect(page.getByTestId("signup-message")).toContainText("An account already exists for this email.");
  }

  await submitSignup(page, {
    workspaceName: `Smoke Signup Limited ${suffix}`,
    ownerName: "Rate Limited Signup User",
    email,
    password,
    confirmPassword: password
  });
  await expect(page.getByTestId("signup-message")).toContainText("Too many workspace signup attempts.");
});

async function submitSignup(
  page: Page,
  values: {
    workspaceName: string;
    ownerName: string;
    email: string;
    password: string;
    confirmPassword: string;
  },
  options: { noValidate?: boolean } = {}
) {
  await page.goto("/signup");
  if (options.noValidate) {
    await page.locator("form").evaluate((form) => {
      (form as HTMLFormElement).noValidate = true;
    });
  }
  await page.getByTestId("signup-workspace-name").fill(values.workspaceName);
  await page.getByTestId("signup-owner-name").fill(values.ownerName);
  await page.getByTestId("signup-email").fill(values.email);
  await page.getByTestId("signup-password").fill(values.password);
  await page.getByTestId("signup-confirm-password").fill(values.confirmPassword);
  await page.getByTestId("signup-submit").click();
}

async function cleanupSignupData() {
  await prisma.workspace.deleteMany({
    where: {
      slug: { startsWith: signupSlugPrefix }
    }
  });

  await prisma.authRateLimit.deleteMany({
    where: {
      email: { startsWith: signupEmailPrefix }
    }
  });

  await prisma.user.deleteMany({
    where: {
      email: { startsWith: signupEmailPrefix }
    }
  });
}
