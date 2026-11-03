import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { oneTap } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

interface AuthEnv {
    BETTER_AUTH_SECRET: string;
    BETTER_AUTH_URL: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
}

/**
 * Per-request Better Auth instance. MUST be a factory — Cloudflare Workers
 * supply the D1 binding per request via `env.DB` from `cloudflare:workers`, so
 * a module-scope singleton would leak the wrong db across requests.
 *
 * Drizzle adapter uses `usePlural: true`; schema column names MUST be
 * snake_case (silent auth failures otherwise).
 *
 * Authorization is authentication-only (CLAUDE.md warning #7): every Google
 * user who signs in is authorized — there is no email allowlist here. Adding
 * one would be the place to gate access.
 */
export function createAuth(d1: D1Database, env: AuthEnv) {
    const db = drizzle(d1, { schema });

    // Passkeys (incl. Face ID / Touch ID / Android biometrics — platform authenticators)
    // are bound to the rpID (registrable domain) and the request origin must match exactly.
    // Both are derived from BETTER_AUTH_URL so dev (localhost), preview, and prod all work.
    const authUrl = new URL(env.BETTER_AUTH_URL);
    const isLocal = authUrl.hostname === "localhost" || authUrl.hostname === "127.0.0.1";
    const rpID = authUrl.hostname;
    const passkeyOrigin = isLocal ? ["http://localhost:5173", "http://localhost:8787"] : authUrl.origin;

    return betterAuth({
        database: drizzleAdapter(db, {
            provider: "sqlite",
            usePlural: true,
            schema
        }),

        baseURL: env.BETTER_AUTH_URL,
        secret: env.BETTER_AUTH_SECRET,

        // Google OAuth is the only entry point; password auth is intentionally off.
        emailAndPassword: {
            enabled: false
        },

        socialProviders: {
            google: {
                clientId: env.GOOGLE_CLIENT_ID,
                clientSecret: env.GOOGLE_CLIENT_SECRET
            }
        },

        plugins: [
            // Google One Tap — frictionless overlay on the existing Google OAuth (no new
            // provider, no new table). Reuses the configured Google client; the browser
            // client (auth-client.ts) supplies the public client id.
            oneTap(),
            // Passkey / WebAuthn = device biometrics (Face ID / Touch ID / fingerprint).
            // `userVerification: "required"` forces the biometric/PIN gesture.
            // `authenticatorAttachment: "platform"` gates registration to the device's built-in
            // biometric authenticator (Face ID / Touch ID; also Windows Hello / Android
            // fingerprint) — roaming security keys cannot register. Registration-time only, so
            // existing passkeys keep working.
            passkey({
                rpID,
                rpName: "Order Processor",
                origin: passkeyOrigin,
                authenticatorSelection: {
                    authenticatorAttachment: "platform",
                    residentKey: "required",
                    userVerification: "required"
                }
            })
        ],

        session: {
            expiresIn: 60 * 60 * 24 * 7,
            updateAge: 60 * 60 * 24,
            cookieCache: {
                enabled: true,
                maxAge: 60 * 5,
                // Global kill switch: bump to instantly invalidate every cached
                // session across all edge nodes (use in security incidents).
                version: "1"
            }
        },

        // D1-backed so limits apply across all Cloudflare edge nodes, not per-node.
        // Better Auth applies stricter built-in rules (3/10s) on sign-in/sign-up.
        rateLimit: {
            enabled: true,
            window: 60,
            max: 20,
            storage: "database"
        },

        advanced: {
            cookiePrefix: "order-processor",
            useSecureCookies: true
        },

        // Must include every host that can issue OAuth callbacks; mirrors
        // CSRF list in svelte.config.js.
        trustedOrigins: ["http://localhost:5173", "http://localhost:8787", "https://order-processor.dropoutstudio.co"]
    });
}

export type Auth = ReturnType<typeof createAuth>;
