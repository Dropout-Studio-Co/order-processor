/// <reference types="@sveltejs/kit" />
/// <reference types="@cloudflare/workers-types" />

import type { CurrentUser } from "#lib/types/index.js";
import type { Auth } from "#lib/server/auth.js";

declare global {
    // Bindings/vars declared in wrangler.jsonc plus secrets set with
    // `wrangler secret put` (or `.dev.vars` locally). SvelteKit 3's Cloudflare
    // adapter exposes these through `cloudflare:workers` rather than
    // `event.platform`. Rerun `bun run cf-typegen` after editing wrangler.jsonc
    // to keep the generated `worker-configuration.d.ts` in sync; this interface
    // keeps the typecheck deterministic when that gitignored file is absent.
    namespace Cloudflare {
        interface Env {
            DB: D1Database;
            AI: Ai;
            VECTORIZE: VectorizeIndex;
            ASSETS: Fetcher;
            BETTER_AUTH_URL: string;
            PUBLIC_GOOGLE_CLIENT_ID: string;
            SEED_SECRET?: string;
            // AES-GCM key (base64, 32 bytes) encrypting each user's BYO
            // Cloudflare token in user_settings. `wrangler secret put` in prod;
            // .dev.vars locally. Optional so absence degrades gracefully.
            TOKEN_ENCRYPTION_KEY?: string;
            BETTER_AUTH_SECRET: string;
            GOOGLE_CLIENT_ID: string;
            GOOGLE_CLIENT_SECRET: string;
            // Preview/E2E-only OAuth bypass — never set in production (warning #20).
            E2E_BYPASS_AUTH?: string;
        }
    }

    namespace App {
        interface Locals {
            user: Auth["$Infer"]["Session"]["user"] | null;
            session: Auth["$Infer"]["Session"]["session"] | null;
            currentUser: CurrentUser | null;
        }

        interface PageData {
            user: Locals["user"];
            session: Locals["session"];
            currentUser: CurrentUser | null;
        }

        interface Error {
            message: string;
            /** Correlates user reports with server logs. */
            errorId?: string;
        }
    }
}

export {};
