<script lang="ts">
    import "../app.css";
    import { fly } from "svelte/transition";
    import { page } from "$app/state";
    import { onNavigate } from "$app/navigation";
    import {
        Footer,
        CopilotSidebar,
        CopilotMobileFab,
        CopilotDesktopLauncher,
        CopilotMobileSheet,
        CopilotConfirmDialog
    } from "#lib/components/index.js";
    import { handleViewTransition, motionDuration } from "#lib/motion/index.js";
    import { copilot } from "#lib/stores/copilot.svelte.js";
    import uploadGif from "#lib/assets/upload.gif";
    import steadfastLogo from "#lib/assets/steadfast.png";

    let { children } = $props();

    onNavigate(handleViewTransition);

    // Copilot rail is scoped to "/" only — never on /login or error pages — and is
    // a signed-in perk: hidden for guests (it costs paid AI calls + needs the
    // server). Its /api/copilot/* routes stay 401-gated regardless.
    const showCopilot = $derived(page.route.id === "/" && !page.error && !!page.data.user);
</script>

<svelte:head>
    <title>Shopify Order Processor</title>
    <meta name="description" content="Turn Chaos into Orders - Process Shopify exports for courier services" />
    <link rel="preload" href={uploadGif} as="image" />
    <link rel="preload" href={steadfastLogo} as="image" />
</svelte:head>

<!-- No rail gutter: the copilot is a toggleable overlay drawer (default closed), so content stays
     full-width whether open or closed and toggling never reflows the page. -->
<div class="flex min-h-dvh flex-col">
    <a
        href="#main"
        class="focus:bg-card focus:text-foreground focus:outline-signal sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:inline-flex focus:items-center focus:rounded-xl focus:px-4 focus:py-2.5 focus:text-sm focus:font-medium focus:shadow-lg focus:outline-2 focus:outline-offset-2"
    >
        Skip to content
    </a>
    <main id="main" tabindex="-1" class="flex grow flex-col outline-none">
        {@render children()}
    </main>
    <Footer />
</div>

{#if showCopilot}
    {#if copilot.desktopOpen}
        <!-- p-2.5 is the inset for the card's rounded corners + shadow. Overlay drawer: slides in
             from the right over content (no gutter reserved). --copilot-rail-width(-xl) tokens set
             the width — CLAUDE.md warning #21: change the tokens, not hard-coded values. -->
        <aside
            class="fixed top-0 right-0 z-40 hidden h-dvh p-2.5 lg:block lg:w-[var(--copilot-rail-width)] xl:w-[var(--copilot-rail-width-xl)]"
            transition:fly={{ x: 448, duration: motionDuration("base"), opacity: 1 }}
        >
            <CopilotSidebar onClose={copilot.closeDesktop} />
        </aside>
    {/if}

    <!-- CopilotMobileFab must precede CopilotDesktopLauncher: the mobile sheet restores focus via
         querySelector('[aria-label="Open AI chat"]'), which returns the first match in DOM order. -->
    <CopilotMobileFab />
    <CopilotDesktopLauncher />
    <CopilotMobileSheet />
    <CopilotConfirmDialog />
{/if}
