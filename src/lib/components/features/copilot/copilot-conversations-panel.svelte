<script lang="ts">
    /**
     * History list shown when the header's history toggle is open (collapsible
     * region inside copilot-sidebar). Lists the store's conversations and switches
     * the active one. Switch/rename/delete all go through `chat-client`, which
     * persists to D1 (warning #23) and lazily loads messages on switch — this
     * panel never touches the network itself. Rename/delete intentionally use the
     * native `prompt`/`confirm` dialogs to stay dependency-free.
     */
    import { copilot } from "#lib/stores/copilot.svelte.js";
    import { switchConversation, renameConversation, deleteConversation } from "#lib/ai/chat-client.js";
    import { Pencil, Trash2 } from "@lucide/svelte";
    import { cn } from "#lib/utils/index.js";

    const onSwitch = (id: string) => {
        void switchConversation(id);
    };

    const onRename = (id: string, currentTitle: string) => {
        const next = prompt("Rename chat", currentTitle);
        if (next && next.trim() && next.trim() !== currentTitle) {
            void renameConversation(id, next.trim());
        }
    };

    const onDelete = (id: string) => {
        if (confirm("Delete this chat?")) {
            void deleteConversation(id);
        }
    };
</script>

<div class="space-y-2">
    {#if copilot.conversations.length === 0}
        <p class="text-chat-text-muted py-3 text-center text-xs text-balance">No chats yet.</p>
    {:else}
        <ul class="chat-scrollbar max-h-60 space-y-1 overflow-y-auto pr-1">
            {#each copilot.conversations as conv (conv.id)}
                {@const active = conv.id === copilot.activeConversationId}
                <li
                    class={cn(
                        "flex items-center gap-1 rounded-lg border border-solid px-2 py-1.5 transition-colors",
                        active
                            ? "border-chat-border bg-chat-surface-hover"
                            : "border-chat-border-subtle bg-chat-surface hover:bg-chat-surface-hover"
                    )}
                >
                    <button
                        type="button"
                        onclick={() => onSwitch(conv.id)}
                        class="flex min-w-0 flex-1 touch-manipulation items-center gap-1.5 text-left select-none"
                        aria-current={active ? "true" : undefined}
                    >
                        {#if active}
                            <span class="bg-chat-text-primary size-1.5 shrink-0 rounded-full" aria-hidden="true"></span>
                        {/if}
                        <span
                            class={cn(
                                "truncate text-xs",
                                active ? "text-chat-text-primary font-medium" : "text-chat-text-secondary"
                            )}
                        >
                            {conv.title}
                        </span>
                    </button>
                    <button
                        type="button"
                        class="text-chat-text-muted hover:text-chat-text-primary hover:bg-chat-surface-hover touch-manipulation rounded-md p-1 transition-colors"
                        onclick={() => onRename(conv.id, conv.title)}
                        aria-label="Rename chat {conv.title}"
                        title="Rename"
                    >
                        <Pencil class="size-3" aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        class="text-chat-text-muted hover:bg-destructive/10 hover:text-destructive touch-manipulation rounded-md p-1 transition-colors"
                        onclick={() => onDelete(conv.id)}
                        aria-label="Delete chat {conv.title}"
                        title="Delete"
                    >
                        <Trash2 class="size-3" aria-hidden="true" />
                    </button>
                </li>
            {/each}
        </ul>
    {/if}
</div>
