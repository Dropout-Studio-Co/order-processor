## What changed

<!-- One or two sentences. Link the issue if there is one. -->

## Why

<!-- Motivation, user impact, or the bug this fixes. -->

## How to test

<!-- Manual steps, plus the commands you ran. -->

```bash
bun run lint
bun run check
bun run test
bun run build
```

## Checklist

- [ ] `bun run lint`, `bun run check`, `bun run test`, and `bun run build` pass locally
- [ ] Behaviour changes are covered by a test in `src/**/*.test.ts` (or the gap is explained)
- [ ] No uploaded order/customer data, credentials, or secrets are logged or exposed
- [ ] Auth, D1 access, CSRF, and rate limits still fail closed (if touched)
- [ ] Schema changes ship with a generated `migrations/` entry, applied locally
- [ ] CSV → workbook output verified against a representative export (if the pipeline changed)
- [ ] UI changes verified at desktop and mobile widths, keyboard and reduced motion included
- [ ] Changelog entry added for user-visible changes (`src/lib/data/changelog.ts`)
