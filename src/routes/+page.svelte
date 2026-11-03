<script lang="ts">
    import { untrack, onMount } from "svelte";
    import { courierService, brandSettings } from "#lib/stores/index.js";
    import { copilot } from "#lib/stores/copilot.svelte.js";
    import { cn } from "#lib/utils/index.js";
    import { Heading, OrderProcessor, Navbar, User, SignInButton, SteadFastSettings } from "#lib/components/index.js";
    import { reveal } from "#lib/motion/index.js";
    import type { PageData } from "./$types";

    let { data }: { data: PageData } = $props();

    // CRITICAL: synchronous hydration via untrack(). DO NOT move into $effect
    // — children read brandSettings during their own mount, and an $effect race
    // left inputs blank until after first render (fixed in commit 6d9d68b).
    // For guests the server state is empty; the real local state loads in onMount
    // (localStorage is browser-only). `authed` routes future writes to D1 vs local.
    untrack(() => {
        brandSettings.hydrate(data.brandSettings, { authed: !!data.user });
        copilot.hydrate(data.copilotConversations);
    });

    // Browser-only persistence bridge: authed → import any prior guest settings
    // into the account once; guest → re-seed the store from localStorage.
    onMount(() => {
        if (data.user) void brandSettings.migrateGuestToServer();
        else brandSettings.loadGuest();
    });

    // bind:editorOpen — true while output-editor replaces the dropzone.
    // Drives the outer layout: editor gets full width; settings stack on top.
    let editorOpen = $state(false);

    // Slide the main column left when the copilot rail opens — same shift the profile row (Navbar) uses.
    const copilotOpen = $derived(copilot.desktopOpen);
</script>

<!-- Invisible navbar: profile/settings/logout (or guest sign-in) in normal flow, content below. -->
<Navbar>
    {#if data.user && data.currentUser}
        <User user={data.user} currentUser={data.currentUser} />
    {:else}
        <SignInButton />
    {/if}
</Navbar>

<!-- Left column of the layout; Copilot rail is mounted by +layout.svelte.
     `reveal` is GSAP-backed and respects prefers-reduced-motion. -->
<div
    class={cn(
        "flex w-full min-w-0 grow flex-col pt-10 pb-8 sm:pt-12",
        "transition-[padding] duration-300 ease-[var(--ease)] motion-reduce:transition-none",
        // The editor owns its own horizontal scroll region, so it uses the viewport
        // gutter instead of the app's centered content gutter at every breakpoint.
        // The upload flow remains intentionally contained.
        editorOpen ? "px-[var(--content-pad)]" : "px-[var(--content-x)]",
        copilotOpen
            ? "lg:pr-[calc(var(--copilot-rail-width)+1.5rem)] xl:pr-[calc(var(--copilot-rail-width-xl)+1.5rem)]"
            : editorOpen
              ? "lg:pr-[var(--content-pad)]"
              : "lg:pr-[var(--content-x)]"
    )}
>
    <div
        class={cn(
            "my-auto flex w-full min-w-0 flex-col gap-12 sm:gap-16 lg:gap-16",
            editorOpen ? "items-stretch" : "items-center lg:items-stretch"
        )}
    >
        <div use:reveal={{ distance: "sm", delay: 0 }}>
            <Heading />
        </div>

        <div
            class={cn(
                "flex w-full min-w-0 items-center justify-center gap-8 sm:gap-10",
                editorOpen
                    ? "max-w-none flex-col"
                    : "max-w-md flex-col-reverse sm:max-w-xl lg:max-w-none lg:flex-row lg:gap-12"
            )}
        >
            <div use:reveal={{ distance: "sm", delay: 0.1 }} class="flex w-full min-w-0 justify-center lg:block">
                <OrderProcessor currentUser={data.currentUser} selectedCourier={courierService.value} bind:editorOpen />
            </div>

            <div
                class={[
                    "flex w-full min-w-0 flex-col items-center gap-6",
                    editorOpen && "lg:flex-row lg:items-start lg:justify-center lg:gap-8"
                ]}
            >
                <div use:reveal={{ distance: "sm", delay: 0.2, onScroll: true }} class="flex w-full justify-center">
                    <SteadFastSettings visible />
                </div>
            </div>
        </div>
    </div>
</div>
