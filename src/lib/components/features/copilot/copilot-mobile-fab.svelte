<script lang="ts">
    /**
     * Floating launcher that opens the Copilot on small screens — `lg:hidden`
     * because the desktop layout docks the rail permanently instead. Hidden once
     * `copilot.mobileOpen` so it never sits under the open sheet; opening flips the
     * same store flag the sheet reads.
     */
    import { copilot } from "#lib/stores/copilot.svelte.js";
    import CopilotLauncherIcon from "./copilot-launcher-icon.svelte";
</script>

{#if !copilot.mobileOpen}
    <div class="fixed right-5 bottom-5 z-40 lg:hidden">
        <span class="chat-btn-ripple-ring" style="animation-delay: 0s" aria-hidden="true"></span>
        <span class="chat-btn-ripple-ring" style="animation-delay: 1.5s" aria-hidden="true"></span>
        <button
            type="button"
            onclick={() => copilot.setMobileOpen(true)}
            class="group border-chat-border bg-chat-surface hover:border-chat-text-muted hover:bg-chat-surface-hover relative z-10 flex size-14 touch-manipulation items-center justify-center rounded-full border border-solid shadow-[var(--chat-shadow)] transition-all duration-300 ease-out active:scale-95"
            aria-label="Open AI chat"
        >
            <CopilotLauncherIcon variant="grid" class="size-6" />
        </button>
    </div>
{/if}
