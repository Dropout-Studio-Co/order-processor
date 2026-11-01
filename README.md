# Order Processor

Turn your Shopify order file into a clean delivery sheet your courier can use right away.

## What it is

A small web app that reads a Shopify order export (`.csv`) and writes an Excel file (`.xlsx`) in the format SteadFast, a delivery service in Bangladesh, expects for bulk import. Order files are processed in the browser and are not saved by the app.

## What you can do

- Upload a Shopify order CSV and download a courier-ready `.xlsx`.
- Review and fix every row in an editable table before exporting.
- Collapse repeated line items into one row per order, with the address joined and the phone number normalized.
- See warnings for empty fields, invalid phone numbers, and non-numeric amounts.
- Let the AI copilot edit the batch for you with plain-language commands.

## Requirements

- [Bun](https://bun.sh) 1.2 or newer.
- Node.js 20.19+ or 22.12+.
- A Cloudflare account with a D1 database named `order_processor` (needed for sign-in and saved settings; the local copy is created by the migration command).
- A Google OAuth client, only if you want Google sign-in.

## Setup

```bash
git clone https://github.com/Dropout-Studio-Co/order-processor.git
cd order-processor
bun install
bun run db:migrate:local
```

## Run

```bash
bun run dev      # http://localhost:5173
bun run preview  # http://localhost:8787, with local D1 and auth
```

`bun run dev` is enough for everyday work: it binds the local D1 database through `wrangler.jsonc`, so sign-in works there too. Use `bun run preview` to test the production build.

## Configuration

Create `.dev.vars` in the project root:

```dotenv
BETTER_AUTH_SECRET=      # openssl rand -base64 32
BETTER_AUTH_URL=http://localhost:5173
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
TOKEN_ENCRYPTION_KEY=    # openssl rand -base64 32, needed by the copilot
PUBLIC_GOOGLE_CLIENT_ID= # optional, enables Google One Tap
```

The remote database commands read `.env`:

```dotenv
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_DATABASE_ID=
CLOUDFLARE_D1_TOKEN=
```

Never commit either file. Store production secrets with `wrangler secret put`.

## Troubleshooting

- **Rows land in the wrong columns.** The parser relies on Shopify's standard order export column order. Re-export the orders without moving or removing columns.
- **Phone or amount warnings.** Phones must be Bangladesh mobile numbers (`01XXXXXXXXX`); amounts must be positive numbers.
- **Sign-in or copilot unavailable.** Run `bun run db:migrate:local` first so the local database has tables, then check `.dev.vars`. The copilot also needs your own Cloudflare account connected at `/settings`.

## License

MIT — see [LICENSE](./LICENSE).
