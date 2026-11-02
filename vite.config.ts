import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
    plugins: [tailwindcss(), sveltekit()],
    test: {
        // Node-only unit tests for the CSV → SteadFast → XLSX pipeline.
        // `src/lib/ds/*.test.js` are vendored `node:test` contract scripts, not
        // Vitest suites — the `.ts`-only include glob keeps them untouched.
        include: ["src/**/*.test.ts"],
        environment: "node",
        reporters: ["default"]
    }
});
