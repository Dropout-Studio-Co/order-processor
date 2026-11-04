import type { Handle, HandleServerError } from "@sveltejs/kit/hooks";
import { svelteKitHandler } from "better-auth/svelte-kit";
import { env } from "cloudflare:workers";
import { building } from "$app/env";
import { drizzle } from "drizzle-orm/d1";
import { createAuth } from "#lib/server/auth.js";
import { users } from "#lib/server/schema.js";
import { getCurrentUser } from "#lib/hooks/index.js";

// 'unsafe-inline' is REQUIRED for SvelteKit hydration scripts and Tailwind
// scoped styles — do not tighten without testing. lh3.googleusercontent.com
// serves Google OAuth avatars; fonts.* serves Google Fonts loaded in app.html.
// Google One Tap loads the GSI script + renders a FedCM iframe from
// accounts.google.com, so script-src/style-src/frame-src must allow it.
// Cloudflare Web Analytics (automatic edge injection) loads its beacon from
// static.cloudflareinsights.com and posts reports same-origin to /cdn-cgi/rum.
// Keep the script host host-only: the injected URL is /beacon.min.js/v<version>,
// and CSP path matching would block it unless the path ended in "/".
// Passkey/WebAuthn needs no CSP change.
const CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/client https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com/gsi/style",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: https://lh3.googleusercontent.com",
    "connect-src 'self' https://accounts.google.com/gsi/",
    "frame-src https://accounts.google.com/gsi/",
    "frame-ancestors 'none'"
].join("; ");

const SECURITY_HEADERS = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY", // legacy fallback for browsers without CSP frame-ancestors
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // `identity-credentials-get` is required for the modern FedCM-based Google One Tap prompt.
    "Permissions-Policy":
        'camera=(), microphone=(), geolocation=(), identity-credentials-get=(self "https://accounts.google.com")'
} as const;

// SvelteKit redirect responses have immutable headers; catch and clone.
function applySecurityHeaders(response: Response): Response {
    try {
        for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
            response.headers.set(key, value);
        }
        return response;
    } catch {
        const newResponse = new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: new Headers(response.headers)
        });
        for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
            newResponse.headers.set(key, value);
        }
        return newResponse;
    }
}

// `building` guard is critical: D1 binding is absent during prerender.
// Removing this crashes the build.
export const handle: Handle = async ({ event, resolve }) => {
    if (building) {
        return resolve(event);
    }

    const db = env.DB;

    if (!db) {
        // Happens when the D1 binding is unavailable (a misconfigured deployment).
        // Still apply the security headers — this path serves real responses.
        console.warn("D1 database not available - auth disabled");
        event.locals.user = null;
        event.locals.session = null;
        event.locals.currentUser = null;
        return applySecurityHeaders(await resolve(event));
    }

    // Synthesizes event.locals to bypass Google OAuth for local dev / Wrangler preview only.
    // DOUBLE-GATED (defense in depth):
    //   (1) E2E_BYPASS_AUTH=true — lives in `.dev.vars` (gitignored); MUST NOT appear in
    //       wrangler.jsonc/secrets. Cloudflare never uploads `.dev.vars`, so it can't reach prod
    //       (this flag-absence is the PRIMARY safety).
    //   (2) request host is localhost/127.0.0.1 — a SECOND factor, so even if the flag ever leaked
    //       into a deployed env, the bypass stays inert on the prod domain (order-processor.dropoutstudio.co).
    // NOT query-param-gated — a param is attacker-controlled; a bound env var + the request host are not.
    // Synthesizes a session and upserts the e2e-test-user row so FK-bound app data has a real owner.
    // MUST NEVER be enabled in production — it grants full unauthenticated access.
    const isLocalDev = event.url.hostname === "localhost" || event.url.hostname === "127.0.0.1";
    if (isLocalDev && env.E2E_BYPASS_AUTH === "true") {
        const now = new Date();
        const userId = "e2e-test-user";
        const dz = drizzle(db);
        await dz
            .insert(users)
            .values({
                id: userId,
                email: "e2e@test.local",
                emailVerified: true,
                name: "E2E Test User",
                image: null,
                createdAt: now,
                updatedAt: now
            })
            .onConflictDoNothing();
        event.locals.user = {
            id: userId,
            email: "e2e@test.local",
            emailVerified: true,
            name: "E2E Test User",
            image: null,
            createdAt: now,
            updatedAt: now
        } as App.Locals["user"];
        event.locals.session = {
            id: "e2e-test-session",
            userId,
            token: "e2e-test-token",
            expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
            ipAddress: null,
            userAgent: null,
            createdAt: now,
            updatedAt: now
        } as App.Locals["session"];
        event.locals.currentUser = getCurrentUser(event.locals.user);
        return applySecurityHeaders(await resolve(event));
    }

    const authEnv = {
        BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET ?? "",
        BETTER_AUTH_URL: env.BETTER_AUTH_URL ?? "http://localhost:5173",
        GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID ?? "",
        GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET ?? ""
    };

    if (!authEnv.BETTER_AUTH_SECRET) {
        console.error("[auth] BETTER_AUTH_SECRET is not set — auth will fail in production");
    }

    const auth = createAuth(db, authEnv);

    let session;
    try {
        session = await auth.api.getSession({
            headers: event.request.headers
        });
    } catch {
        session = null;
    }

    if (session) {
        event.locals.session = session.session;
        event.locals.user = session.user;
        event.locals.currentUser = getCurrentUser(session.user);
    } else {
        event.locals.session = null;
        event.locals.user = null;
        event.locals.currentUser = null;
    }

    // svelteKitHandler dispatches /api/auth/* to Better Auth; other routes pass through.
    const response = await svelteKitHandler({ event, resolve, auth, building });
    return applySecurityHeaders(response);
};

// errorId is returned to the client and logged here so user reports map back to a Cloudflare log entry.
// SvelteKit 3 routes expected app errors through this hook too, so only unexpected kinds and 5xx
// responses are logged at error level; a deliberate 401/404 is a warning, not an incident.
export const handleError: HandleServerError = ({ kind, error, event }) => {
    const errorId = crypto.randomUUID();
    const normalized =
        kind === "app" || kind === "framework"
            ? { status: error.status, message: error.message, cause: error }
            : {
                  status: kind === "validation" ? 400 : 500,
                  message: kind === "validation" ? "Bad Request" : "Internal Error",
                  cause: error
              };
    const expected = kind === "app" || (kind === "framework" && normalized.status < 500);
    const label = expected ? `${kind} error` : "Unhandled error";
    const log = expected ? console.warn : console.error;

    log(`[${errorId}] ${label}:`, {
        kind,
        status: normalized.status,
        message: normalized.message,
        url: event.url.pathname,
        method: event.request.method,
        error:
            normalized.cause instanceof Error
                ? { name: normalized.cause.name, message: normalized.cause.message, stack: normalized.cause.stack }
                : normalized.cause
    });

    return {
        message: normalized.status >= 500 ? "An unexpected error occurred" : normalized.message,
        errorId
    };
};
