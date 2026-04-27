# Sales Oversight Spreadsheet

A modern spreadsheet-based sales oversight system for team reporting, monitoring, and decision support.

## Stack

- Next.js App Router with TypeScript
- Tailwind CSS
- MySQL
- Prisma ORM
- Credential-based auth scaffold with signed HTTP-only sessions
- Zod validation
- Structured editable report grid

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example` and set:

```bash
DATABASE_URL="mysql://USER:PASSWORD@localhost:3306/sales_oversight"
SESSION_SECRET="replace-with-at-least-32-random-characters"
```

3. Create and migrate the database:

```bash
npm run prisma:migrate
```

4. Seed demo data:

```bash
npm run prisma:seed
```

5. Run locally:

```bash
npm run dev
```

## Demo Credentials

All seeded users use `demo1234`.

- `owner@northstar.test`
- `manager@northstar.test`
- `maria@northstar.test`
- `devon@northstar.test`
- `samira@northstar.test`

## Notes

The auth scaffold is intentionally simple for phase 1. It uses password hashes, signed HTTP-only cookies, workspace-aware memberships, and server-side role checks. For production hardening, add rate limiting, password reset, audit trails, invite flows, and session persistence/revocation.
