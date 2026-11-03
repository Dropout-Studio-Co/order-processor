<script lang="ts">
    /**
     * The input dock (child of copilot-sidebar): auto-growing textarea, drag/drop
     * image zone, send button. `value` is `$bindable` so the sidebar owns the
     * draft and can clear it on new-conversation; pending image attachments live
     * on the copilot store (max 3). `focusNonce` is a focus *signal*, not a flag —
     * the sidebar bumps it (via the store) to pull focus here after a suggestion
     * click; the effect ignores its 0 seed value so it doesn't steal focus on
     * mount. Drop events are delegated to the child upload component through its
     * exported `addFile`, reusing its validation/re-encode.
     */
    import { ArrowUp, ImagePlus } from "@lucide/svelte";
    import { cn } from "#lib/utils/index.js";
    import { copilot } from "#lib/stores/copilot.svelte.js";
    import CopilotImageUpload from "./copilot-image-upload.svelte";

    let {
        value = $bindable<string>(""),
        disabled = false,
        focusNonce = 0,
        onSend
    }: {
        value: string;
        disabled?: boolean;
        focusNonce?: number;
        onSend: (text: string) => void;
    } = $props();

    const MAX_HEIGHT = 200;

    let textareaEl = $state<HTMLTextAreaElement | null>(null);
    let uploadRef = $state<CopilotImageUpload | null>(null);
    let dragging = $state(false);
    let imageError = $state<string | null>(null);

    const trimmed = $derived(value.trim());
    const hasImages = $derived(copilot.pendingImages.length > 0);
    const attachFull = $derived(copilot.pendingImages.length >= copilot.maxPendingImages);
    const canSubmit = $derived((trimmed.length > 0 || hasImages) && !disabled);

    $effect(() => {
        if (!textareaEl) return;
        void value;
        textareaEl.style.height = "auto";
        textareaEl.style.height = `${Math.min(textareaEl.scrollHeight, MAX_HEIGHT)}px`;
    });

    $effect(() => {
        if (focusNonce === 0) return;
        queueMicrotask(() => textareaEl?.focus());
    });

    const handleSubmit = () => {
        if (!canSubmit) return;
        onSend(trimmed);
        value = "";
        if (textareaEl) {
            textareaEl.style.height = "auto";
        }
    };

    const handleImageError = (msg: string) => {
        imageError = msg;
        setTimeout(() => {
            imageError = null;
        }, 5000);
    };

    const handleDrop = (event: DragEvent) => {
        event.preventDefault();
        dragging = false;
        const files = Array.from(event.dataTransfer?.files ?? []);
        for (const file of files) void uploadRef?.addFile(file);
    };

    const handleDragOver = (event: DragEvent) => {
        event.preventDefault();
        dragging = true;
    };

    const handleDragLeave = (event: DragEvent) => {
        const target = event.currentTarget as HTMLElement;
        if (!target.contains(event.relatedTarget as Node)) {
            dragging = false;
        }
    };
</script>

<div class="px-3 pt-2 pb-3 md:px-4 md:pb-4">
    <div
        class={cn(
            "border-chat-border bg-chat-surface relative rounded-2xl border border-solid px-3 pt-2.5 pb-9 transition-colors duration-150 md:px-4 md:pt-3 md:pb-10",
            dragging && "border-chat-accent/30 bg-chat-accent/5"
        )}
        ondrop={handleDrop}
        ondragover={handleDragOver}
        ondragleave={handleDragLeave}
        role="presentation"
    >
        {#if dragging}
            <div
                class="border-chat-accent/30 bg-chat-accent/5 absolute inset-0 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed"
            >
                <span class="text-chat-text-secondary text-sm">drop an image here</span>
            </div>
        {/if}

        <CopilotImageUpload bind:this={uploadRef} onError={handleImageError} />

        <textarea
            bind:this={textareaEl}
            bind:value
            name="copilot-prompt"
            onkeydown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    handleSubmit();
                }
            }}
            placeholder={disabled ? "generating response..." : "describe a change to make..."}
            aria-label="Type a request"
            rows={2}
            {disabled}
            class={cn(
                "text-chat-text-primary chat-scrollbar min-h-[3.25rem] w-full resize-none bg-transparent text-base leading-relaxed transition-[height] duration-100 ease-out outline-none md:text-sm",
                disabled ? "placeholder:text-chat-text-secondary" : "placeholder:text-chat-text-muted"
            )}
            style="max-height: {MAX_HEIGHT}px;"></textarea>

        {#if imageError}
            <div role="alert" aria-live="assertive" class="text-destructive px-1 pb-1 text-xs text-pretty">
                {imageError}
            </div>
        {/if}

        <div class="absolute right-3 bottom-2.5 flex items-center gap-2">
            <button
                type="button"
                disabled={disabled || attachFull}
                aria-label={attachFull ? `Attachment limit reached (${copilot.maxPendingImages})` : "Attach an image"}
                title={attachFull ? `Up to ${copilot.maxPendingImages} images` : "Attach an image"}
                onclick={() => uploadRef?.triggerUpload()}
                class={cn(
                    "relative touch-manipulation rounded-full p-2 transition-all duration-200 ease-[var(--ease)]",
                    hasImages
                        ? "bg-chat-accent-muted text-chat-text-primary"
                        : "text-chat-text-muted hover:text-chat-text-secondary",
                    (disabled || attachFull) && "cursor-not-allowed opacity-50"
                )}
            >
                <ImagePlus class="h-4 w-4" aria-hidden="true" />
            </button>
            <button
                type="button"
                onclick={handleSubmit}
                disabled={!canSubmit}
                aria-label={disabled ? "Generating response" : "Send message"}
                class={cn(
                    "touch-manipulation rounded-full p-2 transition-all duration-200 ease-[var(--ease)]",
                    disabled
                        ? "bg-chat-accent-muted/40 text-chat-text-muted cursor-not-allowed"
                        : canSubmit
                          ? "bg-signal text-background hover:bg-signal/90"
                          : "text-chat-text-muted cursor-not-allowed"
                )}
            >
                {#if disabled}
                    <div class="flex h-4 w-4 items-center justify-center gap-[3px]" aria-hidden="true">
                        <span
                            class="chat-dot-pulse bg-chat-text-muted h-1 w-1 rounded-full"
                            style="animation-delay: 0s;"
                        ></span>
                        <span
                            class="chat-dot-pulse bg-chat-text-muted h-1 w-1 rounded-full"
                            style="animation-delay: 0.2s;"
                        ></span>
                        <span
                            class="chat-dot-pulse bg-chat-text-muted h-1 w-1 rounded-full"
                            style="animation-delay: 0.4s;"
                        ></span>
                    </div>
                {:else}
                    <ArrowUp class="h-4 w-4" aria-hidden="true" />
                {/if}
            </button>
        </div>

        <span class="text-chat-text-muted/60 text-micro absolute bottom-2.5 left-4 tracking-[0.1em] uppercase">
            {#if disabled}
                generating…
            {:else}
                <span class="hidden md:inline">shift + enter for new line</span>
            {/if}
        </span>
    </div>
</div>
