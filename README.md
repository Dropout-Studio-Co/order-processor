# Order Processor

> Turns store order files into clean, ready-to-send delivery sheets.

Converts Shopify order export CSVs into courier-ready Excel files for the [SteadFast](https://steadfast.com.bd) delivery service in Bangladesh. Sign in with Google, upload a CSV, review and edit the parsed orders in-app, then download a `.xlsx` file — no manual reformatting. An AI copilot can edit the batch for you through natural-language commands.

**Live**: https://order-processor.dropoutstudio.co

Part of the Dropout Studio tools, alongside [Invoice Generator](https://github.com/Dropout-Studio-Co/invoice-generator) and [Day Zero](https://github.com/Dropout-Studio-Co/day-zero) — same stack, same Dropout Design System.

---

## Tech Stack

| Layer              | Technology                                       |
| ------------------ | ------------------------------------------------ |
| Framework          | SvelteKit 2 + Svelte 5 (runes)                   |
| Language           | TypeScript (strict)                              |
| Styling            | Tailwind CSS v4                                  |
| UI / Design System | Dropout Design System (vendored) + shadcn-svelte |
| Auth               | Better Auth (Google OAuth)                       |
| Database           | Cloudflare D1 + Drizzle ORM                      |
| AI Copilot         | Cloudflare Workers AI                            |
| CSV Parsing        | PapaParse                                        |
| Excel Export       | SheetJS                                          |
| Deployment         | Cloudflare Workers                               |
| Package manager    | Bun                                              |

---

## Setup

**Prerequisites**: Bun, a Cloudflare account with a D1 database named `order_processor`, a Google Cloud OAuth 2.0 client.

```bash
git clone https://github.com/Dropout-Studio-Co/order-processor.git
cd order-processor
bun install
```

Create `.dev.vars` at the project root (Worker runtime secrets, read by the dev server):

```dotenv
BETTER_AUTH_SECRET=      # openssl rand -base64 32
BETTER_AUTH_URL=http://localhost:5173
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

Apply migrations and start:

```bash
bun run db:migrate:local
bun run dev              # http://localhost:5173
```

`vite dev` binds the local D1 database and reads `.dev.vars` through the Cloudflare platform proxy, so Google sign-in works at `http://localhost:5173`.

---

## Environment Variables

Two gitignored files at the project root, each read by a different tool. Never commit either.

`.dev.vars` — Worker runtime secrets, loaded by the dev server and Wrangler:

| Variable               | Description                                    |
| ---------------------- | ---------------------------------------------- |
| `BETTER_AUTH_SECRET`   | Random secret for session signing              |
| `BETTER_AUTH_URL`      | App base URL — `http://localhost:5173` locally |
| `GOOGLE_CLIENT_ID`     | Google OAuth client ID                         |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret                     |

`.env` — Cloudflare credentials for the Drizzle CLI, used only by the remote `db:*` commands (loaded by Bun):

| Variable                 | Description                                  |
| ------------------------ | -------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`  | Cloudflare account ID                        |
| `CLOUDFLARE_DATABASE_ID` | D1 database ID                               |
| `CLOUDFLARE_D1_TOKEN`    | Cloudflare API token with D1 edit permission |

In production, set the `.dev.vars` values as Worker secrets via `wrangler secret put`; `BETTER_AUTH_URL` is a non-secret binding in `wrangler.jsonc`.

---

## Scripts

| Script                     | Description                            |
| -------------------------- | -------------------------------------- |
| `bun run dev`              | Dev server on `:5173`                  |
| `bun run preview`          | Wrangler local preview on `:8787`      |
| `bun run build`            | Production build                       |
| `bun run deploy`           | Build + deploy to Cloudflare Workers   |
| `bun run check`            | Type & Svelte checking (svelte-check)  |
| `bun run lint`             | Prettier + ESLint                      |
| `bun run format`           | Prettier auto-format                   |
| `bun run cf-typegen`       | Regenerate Cloudflare types            |
| `bun run db:generate`      | Generate migration from schema changes |
| `bun run db:migrate`       | Apply migrations to production D1      |
| `bun run db:migrate:local` | Apply migrations to local D1           |

---

## Deployment

Set production secrets, then deploy:

```bash
wrangler secret put BETTER_AUTH_SECRET
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
bun run deploy
```

---

## Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials
2. Create an OAuth 2.0 Client ID (Web application)
3. Add authorized redirect URIs:
    - `http://localhost:5173/api/auth/callback/google` (local)
    - `https://order-processor.dropoutstudio.co/api/auth/callback/google` (production)

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for local setup, architecture guidelines, coding standards, and the commit and PR workflow.

## License

MIT — see [LICENSE](./LICENSE).

## Author

**Rahi Khan** · [beyourahi.com](https://beyourahi.com) · [beyourahi@gmail.com](mailto:beyourahi@gmail.com)
