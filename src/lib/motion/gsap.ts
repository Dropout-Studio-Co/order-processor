// SSR-safety invariant (load-bearing): GSAP touches window/document at module
// eval, which crashes SSR on Cloudflare Workers. This is the ONLY file allowed
// to import "gsap", and it does so exclusively through the `browser`-guarded
// dynamic import() in load(). Never add a top-level `import ... from "gsap"`
// here or anywhere else, and never call load() outside the browser guard.
import { browser } from "$app/env";
import { DURATION, EASE } from "#lib/motion/tokens.js";

type GsapModule = (typeof import("gsap"))["gsap"];
type ScrollTriggerModule = (typeof import("gsap/ScrollTrigger"))["ScrollTrigger"];
type FlipModule = (typeof import("gsap/Flip"))["Flip"];

export interface GsapBundle {
    gsap: GsapModule;
    ScrollTrigger: ScrollTriggerModule;
    Flip: FlipModule;
}

// Module-singleton cache: the bundle is loaded once and reused. `loading`
// dedupes concurrent first-callers so plugins register exactly once.
let bundle: GsapBundle | null = null;
let loading: Promise<GsapBundle> | null = null;

const load = async (): Promise<GsapBundle> => {
    const [{ gsap }, { ScrollTrigger }, { Flip }] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
        import("gsap/Flip")
    ]);

    gsap.registerPlugin(ScrollTrigger, Flip);
    gsap.defaults({ ease: EASE.standard, duration: DURATION.base });

    bundle = { gsap, ScrollTrigger, Flip };
    return bundle;
};

export const getGsap = async (): Promise<GsapBundle | null> => {
    if (!browser) return null;
    if (bundle) return bundle;
    if (!loading) loading = load();
    return loading;
};

// Synchronous, non-loading peek: returns the bundle only if already loaded,
// otherwise null. For call sites that must not trigger a load (e.g. cleanup).
export const peekGsap = (): GsapBundle | null => bundle;
