import { defineConfig } from "vitest/config";

// Unit tests cover pure TS modules only (no Svelte components, D1 or browser), so
// they run without the app's Vite/SvelteKit plugin chain — that keeps `bun run
// test` independent of the Cloudflare adapter's dev-time platform proxy, which
// needs Cloudflare credentials for the remote AI/Vectorize bindings in CI.
export default defineConfig({
    test: {
        include: ["src/**/*.test.ts"],
        environment: "node",
        reporters: ["default"]
    }
});
