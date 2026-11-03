import adapter from "@sveltejs/adapter-cloudflare";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
    plugins: [
        tailwindcss(),
        sveltekit({
            preprocess: vitePreprocess({ script: true }),
            adapter: adapter({
                platformProxy: { configPath: "wrangler.jsonc" },
                routes: { include: ["/*"], exclude: ["<all>"] }
            }),

            // CSRF allowlist; MUST mirror trustedOrigins in #lib/server/auth.ts.
            csrf: {
                trustedOrigins: [
                    "http://localhost:5173",
                    "http://localhost:8787",
                    "https://order-processor.dropoutstudio.co"
                ]
            }
        })
    ],
    test: {
        // Node-only unit tests for the CSV → SteadFast → XLSX pipeline.
        // `src/lib/ds/*.test.js` are vendored `node:test` contract scripts, not
        // Vitest suites — the `.ts`-only include glob keeps them untouched.
        include: ["src/**/*.test.ts"],
        environment: "node",
        reporters: ["default"]
    }
});
