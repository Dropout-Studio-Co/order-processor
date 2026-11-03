import adapter from "@sveltejs/adapter-cloudflare";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

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
    ]
});
