import { tick } from "svelte";
import { getGsap } from "#lib/motion/gsap.js";
import { prefersReducedMotion } from "#lib/motion/reduced-motion.svelte.js";
import { DURATION, DURATION_MS, EASE, STAGGER, DISTANCE } from "#lib/motion/tokens.js";
import type { DurationToken, DistanceToken, StaggerToken } from "#lib/motion/tokens.js";

export interface StaggerOptions {
    distance?: DistanceToken;
    duration?: DurationToken;
    amount?: StaggerToken;
}

export const stagger = async (targets: ArrayLike<Element>, options?: StaggerOptions): Promise<() => void> => {
    if (prefersReducedMotion.current) return () => {};

    const els = Array.from(targets) as HTMLElement[];
    if (els.length === 0) return () => {};

    for (const el of els) el.style.opacity = "0";

    const loaded = await getGsap();
    if (!loaded) {
        for (const el of els) el.style.opacity = "";
        return () => {};
    }

    const tween = loaded.gsap.fromTo(
        els,
        { opacity: 0, y: DISTANCE[options?.distance ?? "sm"] },
        {
            opacity: 1,
            y: 0,
            duration: DURATION[options?.duration ?? "base"],
            ease: EASE.decelerate,
            stagger: STAGGER[options?.amount ?? "base"],
            clearProps: "opacity,transform"
        }
    );

    return () => tween.kill();
};

/**
 * FLIP helper for list reorder/add/remove. Two-phase: call it BEFORE the DOM
 * mutation to snapshot positions, then await the returned function AFTER the
 * mutation to animate from old to new layout. The returned fn awaits `tick()`
 * so Svelte has flushed the DOM. Under reduced motion both phases are no-ops.
 */
export const flipList = async (container: Element): Promise<() => Promise<void>> => {
    if (prefersReducedMotion.current) return async () => {};

    const loaded = await getGsap();
    if (!loaded) return async () => {};

    const { gsap, Flip } = loaded;
    const state = Flip.getState(container.children);

    return async () => {
        await tick();
        Flip.from(state, {
            duration: DURATION.base,
            ease: EASE.emphasized,
            absolute: true,
            onEnter: (els) => gsap.fromTo(els, { opacity: 0 }, { opacity: 1, duration: DURATION.fast }),
            onLeave: (els) => gsap.to(els, { opacity: 0, duration: DURATION.fast })
        });
    };
};

// Resolves a duration token to milliseconds for non-GSAP timing (setTimeout,
// Svelte transitions). Returns 0 under reduced motion so callers collapse to
// instant without branching themselves.
export const motionDuration = (token: DurationToken = "base"): number =>
    prefersReducedMotion.current ? 0 : DURATION_MS[token];
