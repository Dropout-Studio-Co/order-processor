// Reactive mirror of the OS `prefers-reduced-motion` setting, exposed as a
// `.current` getter so any rune/component re-runs when the user toggles it.
// SSR-safe: defaults to false (no reduction) when `window` is unavailable, and
// the change listener is only attached in the browser. Every motion entry point
// short-circuits on this — it is the global gate for honouring reduced motion.
import { browser } from "$app/env";

const QUERY = "(prefers-reduced-motion: reduce)";

const createReducedMotion = () => {
    let reduced = $state(browser ? window.matchMedia(QUERY).matches : false);

    if (browser) {
        window.matchMedia(QUERY).addEventListener("change", (event) => {
            reduced = event.matches;
        });
    }

    return {
        get current() {
            return reduced;
        }
    };
};

export const prefersReducedMotion = createReducedMotion();
