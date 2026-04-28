# Security Notes

## Next.js bundled PostCSS advisory

- Advisory: GHSA-qx2v-qp2m-jg93 / CVE-2026-41305.
- Severity: moderate.
- Package: `postcss`.
- Affected path in this app before mitigation: `next@16.2.4 -> postcss@8.4.31`.
- Fixed PostCSS version: `8.5.10`.
- Installed patched version after mitigation: `8.5.12`.

The advisory concerns PostCSS stringifying CSS that contains `</style>` and embedding that output directly inside an HTML `<style>` tag. This app does not accept user-authored CSS or re-stringify imported spreadsheet data as CSS. Current practical exposure is therefore low, but `npm audit` correctly flags Next's bundled dependency.

Checked commands:

```bash
npm view next version
npm view next@16 version dependencies.postcss
npm audit --audit-level=moderate
```

As of this pass, the latest published Next.js 16 release is `16.2.4`, and every published `16.x` release declares `postcss@8.4.31`. No same-major Next patch is available that updates the nested PostCSS dependency.

Mitigation applied:

```json
"overrides": {
  "postcss": "$postcss"
}
```

This resolves the audit by deduping Next's nested PostCSS dependency to the direct patched PostCSS dependency.

Planned follow-up: remove the override once Next.js ships a same-major release that depends on a non-vulnerable PostCSS version, then rerun `npm audit --audit-level=moderate`, lint, typecheck, build, and smoke tests.

## Sessions

Session cookies are signed, HTTP-only, same-site cookies. They now include a `sessionVersion` from the `User` row. Protected app contexts and sensitive server actions re-check active workspace membership and the current user session version before continuing.

To revoke all sessions for a user, increment `User.sessionVersion` in the database. Existing cookies with the previous version are rejected on the next protected request or server action.

The session lifetime remains 12 hours. Stale roles are handled separately by DB-current membership checks.

## Sign-in rate limiting

Failed sign-in attempts are rate-limited by normalized email plus hashed IP address:

- 5 failed attempts within 15 minutes.
- Lockout lasts 15 minutes.
- Successful sign-in clears the counter for that email/IP pair.

The error messages are generic and do not disclose whether an email exists.
