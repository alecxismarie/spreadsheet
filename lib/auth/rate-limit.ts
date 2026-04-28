import "server-only";

import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";

export const SIGN_IN_RATE_LIMIT = {
  maxFailedAttempts: 5,
  windowMs: 15 * 60 * 1000,
  lockoutMs: 15 * 60 * 1000
} as const;

export const RATE_LIMITED_SIGN_IN_MESSAGE = "Too many sign-in attempts. Try again later.";
export const INVALID_SIGN_IN_MESSAGE = "Invalid email or password.";

export function normalizeSignInEmail(email: string) {
  return email.trim().toLowerCase();
}

export function resolveClientIp(headers: Headers) {
  const forwardedFor = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || headers.get("x-real-ip") || "local";
}

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function rateLimitKey(email: string, ip: string) {
  const ipHash = hashValue(ip);
  return {
    key: hashValue(`${email}:${ipHash}`),
    ipHash
  };
}

export async function isSignInRateLimited(email: string, ip: string, now = new Date()) {
  const { key } = rateLimitKey(email, ip);
  const record = await prisma.authRateLimit.findUnique({ where: { key } });
  return Boolean(record?.lockedUntil && record.lockedUntil > now);
}

export async function recordFailedSignIn(email: string, ip: string, now = new Date()) {
  const { key, ipHash } = rateLimitKey(email, ip);
  const record = await prisma.authRateLimit.findUnique({ where: { key } });
  const windowExpired = record ? now.getTime() - record.windowStartedAt.getTime() > SIGN_IN_RATE_LIMIT.windowMs : true;

  if (!record || windowExpired) {
    await prisma.authRateLimit.upsert({
      where: { key },
      create: {
        key,
        email,
        ipHash,
        attempts: 1,
        windowStartedAt: now,
        lockedUntil: null
      },
      update: {
        attempts: 1,
        windowStartedAt: now,
        lockedUntil: null
      }
    });
    return;
  }

  const attempts = record.attempts + 1;
  await prisma.authRateLimit.update({
    where: { key },
    data: {
      attempts,
      lockedUntil: attempts >= SIGN_IN_RATE_LIMIT.maxFailedAttempts ? new Date(now.getTime() + SIGN_IN_RATE_LIMIT.lockoutMs) : null
    }
  });
}

export async function clearSignInRateLimit(email: string, ip: string) {
  const { key } = rateLimitKey(email, ip);
  await prisma.authRateLimit.deleteMany({ where: { key } });
}

export async function pruneExpiredSignInRateLimits(now = new Date()) {
  const cutoff = new Date(now.getTime() - Math.max(SIGN_IN_RATE_LIMIT.windowMs, SIGN_IN_RATE_LIMIT.lockoutMs) * 2);
  await prisma.authRateLimit.deleteMany({
    where: {
      updatedAt: { lt: cutoff },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }]
    }
  });
}
