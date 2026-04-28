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

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example`:

```bash
copy .env.example .env
```

The default local Docker database uses:

```bash
DATABASE_URL="mysql://root:root_password@localhost:3306/sales_oversight"
SESSION_SECRET="replace-with-at-least-32-random-characters"
```

3. Start the local MySQL database:

```bash
npm run db:start
```

This creates a named Docker volume for MySQL data. It does not reset or remove existing data.

4. Verify the database is reachable:

```bash
npm run db:health
```

5. Run migrations and verify migration state:

```bash
npm run prisma:migrate
npm run prisma:status
```

6. Seed demo data:

```bash
npm run prisma:seed
```

7. Run locally:

```bash
npm run dev
```

8. Open the app:

```bash
http://localhost:3000
```

## Demo Credentials

All seeded users use `demo1234`.

- `owner@northstar.test`
- `manager@northstar.test`
- `maria@northstar.test`
- `devon@northstar.test`
- `samira@northstar.test`

## Smoke Tests

Smoke tests use Playwright and the seeded local database. Start MySQL, run migrations, seed data, then run:

```bash
npm run test:smoke
```

If browsers are not installed yet, run:

```bash
npx playwright install chromium
```

The smoke suite starts the Next.js dev server automatically unless `PLAYWRIGHT_BASE_URL` is set.
It creates records with a `SMOKE TEST ` customer prefix and removes that scoped test data before and after the suite.

## Report Export

The reports page includes CSV export for the current filtered view. Members can export only their own accessible reports; managers and owners can export workspace reports using the current member/status/period/date filters.

CSV export protects spreadsheet tools from formula injection by prefixing user-controlled text cells that start with `=`, `+`, `-`, `@`, tab, carriage return, or newline with a single quote. Native XLSX export is intentionally deferred until a maintained writer dependency is selected and audited.

## Database Commands

```bash
npm run db:start       # start local MySQL
npm run db:stop        # stop local MySQL without deleting the volume
npm run db:health      # non-destructive connection/count check
npm run prisma:status  # non-destructive migration status
```

## Notes

The auth scaffold uses password hashes, signed HTTP-only cookies, workspace-aware memberships, and DB-current server-side role checks for protected actions. For production hardening, add rate limiting, password reset, session revocation, and invite flows.
