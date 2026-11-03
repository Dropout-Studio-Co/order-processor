<script lang="ts">
    /**
     * One chat bubble (child of copilot-message-list). User messages render raw
     * text + optional image; assistant messages render through the in-house
     * `parseMarkdown` (no HTML, no external sanitizer needed). The empty-content +
     * `streaming` branch shows the in-bubble generating wave. Tool-call cards and
     * the relative timestamp hang below the bubble.
     *
     * Warning #19: the `codeblock` branch is rendered as a plain `<p>`, NOT a
     * styled code block — the gateway models intermittently leak reasoning text in
     * fences, so we deliberately downgrade them rather than present them as code.
     */
    import type { CopilotMessage } from "#lib/ai/types.js";
    import type { MdBlock, MdInline } from "#lib/ai/markdown.js";
    import { parseMarkdown } from "#lib/ai/markdown.js";
    import CopilotToolBadge from "./copilot-tool-badge.svelte";
    import { cn } from "#lib/utils/index.js";

    let { message }: { message: CopilotMessage } = $props();

    const isUser = $derived(message.role === "user");
    const blocks = $derived<MdBlock[]>(isUser ? [] : parseMarkdown(message.content));
    const waveBars = [0, 1, 2, 3, 4];

    const timeLabel = $derived.by(() => {
        const parsed = Date.parse(message.createdAt);
        if (Number.isNaN(parsed)) return "";
        const seconds = Math.round((Date.now() - parsed) / 1000);
        if (seconds < 45) return "just now";
        const minutes = Math.round(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.round(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        return `${Math.round(hours / 24)}d ago`;
    });
</script>

{#snippet inline(nodes: MdInline[])}
    {#each nodes as node, i (i)}
        {#if node.type === "text"}{node.value}{:else if node.type === "bold"}<strong
                class="text-chat-text-primary font-semibold">{node.value}</strong
            >{:else if node.type === "italic"}<em class="text-chat-text-secondary opacity-80">{node.value}</em
            >{:else if node.type === "code"}<code
                class="bg-chat-surface text-chat-text-primary rounded px-1 py-0.5 text-[0.85em]">{node.value}</code
            >{:else if node.type === "link"}<a
                href={node.href}
                target="_blank"
                rel="noopener noreferrer"
                class="text-chat-text-primary decoration-chat-accent/50 hover:decoration-chat-accent font-medium underline underline-offset-2 transition-colors"
                >{node.label}</a
            >{/if}
    {/each}
{/snippet}

<div class={cn("mb-3 flex", isUser ? "justify-end" : "justify-start")}>
    <div
        class={cn(
            "flex max-w-[88%] min-w-0 flex-col gap-1.5",
            isUser ? "chat-message-enter-right items-end" : "chat-message-enter items-start"
        )}
    >
        {#if isUser}
            {#if message.images && message.images.length > 0}
                <div class="flex flex-wrap justify-end gap-1.5">
                    {#each message.images as image, i (i)}
                        <img
                            src={image}
                            alt="Attachment {i + 1}"
                            class="border-chat-border-subtle max-h-44 rounded-2xl rounded-br-md border border-solid object-cover"
                        />
                    {/each}
                </div>
            {/if}
            {#if message.content}
                <div
                    class="bg-chat-user-bubble text-chat-text-primary rounded-2xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed"
                >
                    <span class="break-words whitespace-pre-wrap">{message.content}</span>
                </div>
            {/if}
        {:else if message.content}
            <div
                class="border-chat-border-subtle bg-chat-bot-bubble text-chat-text-secondary rounded-2xl rounded-bl-md border border-solid px-4 py-2.5 text-sm"
            >
                <div class="space-y-2.5 leading-relaxed wrap-break-word">
                    {#each blocks as block, bi (bi)}
                        {#if block.type === "paragraph"}
                            <p class="text-pretty">
                                {#each block.lines as line, li (li)}
                                    {#if li > 0}<br />{/if}{@render inline(line)}
                                {/each}
                            </p>
                        {:else if block.type === "heading"}
                            <p class="text-chat-text-primary text-[0.9rem] font-semibold text-balance">
                                {@render inline(block.nodes)}
                            </p>
                        {:else if block.type === "list"}
                            <ul class="space-y-1">
                                {#each block.items as item, ii (ii)}
                                    <li class="flex gap-2">
                                        <span class="text-chat-text-muted shrink-0 tabular-nums select-none">
                                            {block.ordered ? `${ii + 1}.` : "•"}
                                        </span>
                                        <span class="min-w-0 text-pretty">{@render inline(item)}</span>
                                    </li>
                                {/each}
                            </ul>
                        {:else if block.type === "codeblock"}
                            <p class="text-pretty whitespace-pre-wrap">{block.value}</p>
                        {/if}
                    {/each}
                </div>
            </div>
        {:else if message.streaming}
            <div
                class="border-chat-border-subtle bg-chat-bot-bubble flex items-end gap-[3px] rounded-2xl rounded-bl-md border border-solid px-4 py-3"
                role="status"
                aria-label="Generating response"
            >
                {#each waveBars as bar (bar)}
                    <span
                        class="chat-gen-bar bg-chat-text-secondary/40 h-[18px] w-0.5 rounded-[1px]"
                        style="animation-delay: {bar * 0.12}s"
                        aria-hidden="true"
                    ></span>
                {/each}
                <span class="sr-only">Generating response…</span>
            </div>
        {/if}

        {#if message.toolCalls.length > 0}
            <div class="flex w-full flex-col gap-1.5">
                {#each message.toolCalls as call (call.id)}
                    <CopilotToolBadge {call} />
                {/each}
            </div>
        {/if}

        {#if (message.content || (message.images && message.images.length > 0)) && timeLabel}
            <span class="text-chat-text-muted text-micro px-1 tabular-nums">{timeLabel}</span>
        {/if}
    </div>
</div>
