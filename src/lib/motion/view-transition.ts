import type { OnNavigate } from "$app/navigation";
import { prefersReducedMotion } from "#lib/motion/reduced-motion.svelte.js";

type NavigateCallback = Parameters<typeof import("$app/navigation").onNavigate>[0];
type NavigationArg = OnNavigate;

// Tracks whether a route View Transition is in flight. The reveal action reads
// this to skip its mount animation during navigation, so the View Transition
// (not GSAP) owns the cross-page motion and they don't fight on one element.
let navigating = false;

export const isNavigating = (): boolean => navigating;

// Wired via `onNavigate` in +layout.svelte. Falls back to a plain navigation
// (no transition) when the View Transitions API is unavailable or the user
// prefers reduced motion; in both cases `navigating` is still cleared once
// navigation.complete settles so the next reveal animates normally.
export const handleViewTransition: NavigateCallback = (navigation: NavigationArg) => {
    navigating = true;

    const supported = typeof document !== "undefined" && typeof document.startViewTransition === "function";

    if (!supported || prefersReducedMotion.current) {
        void navigation.complete.finally(() => {
            navigating = false;
        });
        return;
    }

    return new Promise<void>((resolve) => {
        const transition = document.startViewTransition(async () => {
            resolve();
            await navigation.complete;
        });
        void transition.finished.finally(() => {
            navigating = false;
        });
    });
};
