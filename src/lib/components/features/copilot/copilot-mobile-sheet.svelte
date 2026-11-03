<script lang="ts">
    /**
     * Mobile presentation of the Copilot: a full-height bottom sheet that hosts
     * CopilotSidebar in `bare` mode (no rail chrome). Visibility is driven by the
     * shared store flag `copilot.mobileOpen`, so the FAB and this sheet stay in sync.
     * Implements a manual focus trap: Tab/Shift+Tab cycle within the panel, Escape
     * closes, focus moves to the first focusable on open, and on close focus is
     * restored to the FAB (queried by its `aria-label="Open AI chat"`). Hidden on
     * `lg+` where the persistent rail takes over.
     */
    import { fade, fly } from "svelte/transition";
    import { tick } from "svelte";
    import { copilot } from "#lib/stores/copilot.svelte.js";
    import CopilotSidebar from "./copilot-sidebar.svelte";

    let panel = $state<HTMLDivElement | null>(null);
    let wasOpen = false;

    const close = () => copilot.setMobileOpen(false);

    const focusable = () =>
        panel
            ? Array.from(
                  panel.querySelectorAll<HTMLElement>(
                      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
                  )
              ).filter((el) => el.offsetParent !== null)
            : [];

    const onKeydown = (event: KeyboardEvent) => {
        if (!copilot.mobileOpen) return;
        if (event.key === "Escape") {
            close();
            return;
        }
        if (event.key !== "Tab") return;
        const items = focusable();
        const first = items[0];
        const last = items.at(-1);
        if (!first || !last) return;
        const active = document.activeElement;
        const outside = !panel?.contains(active);
        if (event.shiftKey && (active === first || outside)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (active === last || outside)) {
            event.preventDefault();
            first.focus();
        }
    };

    $effect(() => {
        if (copilot.mobileOpen) {
            wasOpen = true;
            void tick().then(() => focusable()[0]?.focus());
        } else if (wasOpen) {
            wasOpen = false;
            void tick().then(() => document.querySelector<HTMLElement>('[aria-label="Open AI chat"]')?.focus());
        }
    });
</script>

<svelte:window onkeydown={onKeydown} />

{#if copilot.mobileOpen}
    <div class="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="AI chat">
        <button
            type="button"
            class="bg-scrim absolute inset-0 cursor-default touch-manipulation backdrop-blur-[var(--glass-blur-soft)]"
            aria-label="Close chat"
            onclick={close}
            transition:fade={{ duration: 200 }}
        ></button>
        <div
            bind:this={panel}
            class="bg-chat-bg absolute inset-x-0 bottom-0 flex h-[100dvh] flex-col"
            transition:fly={{ y: 420, duration: 260, opacity: 1 }}
        >
            <CopilotSidebar bare onClose={close} />
        </div>
    </div>
{/if}
