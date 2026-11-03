<script lang="ts">
    /**
     * Image attachment handler for the composer. Pushes validated, WebP-re-encoded
     * data URLs onto the copilot store's `pendingImages` (max 3) and renders their
     * thumbnails. Exposes an imperative surface (`triggerUpload`, `addFile`) the
     * composer routes its picker button and drag-drop through one validated path.
     *
     * Non-obvious: uploads are re-encoded to WebP in an OffscreenCanvas to shrink
     * the data URL before it rides the chat payload to the vision model — GIFs are
     * passed through (animation would be lost) and small WebPs skip re-encode.
     * Any failure (no OffscreenCanvas, decode error) silently falls back to the
     * original file, so the path degrades rather than blocking the attachment.
     */
    import { copilot } from "#lib/stores/copilot.svelte.js";
    import { MAX_IMAGE_BYTES } from "#lib/ai/image-limits.js";
    import { X, Loader2 } from "@lucide/svelte";

    const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/heic", "image/heif"];

    let { onError }: { onError: (msg: string) => void } = $props();

    let fileInput = $state<HTMLInputElement | null>(null);
    // Counter, not a boolean — concurrent encodes must each hold a slot so the
    // cap check in handleFileSelect can't be raced by in-flight files.
    let processing = $state(0);

    const remaining = $derived(copilot.maxPendingImages - copilot.pendingImages.length);
    const isFull = $derived(remaining <= 0);

    export const triggerUpload = () => {
        if (processing === 0 && !isFull) fileInput?.click();
    };

    const reencodeToWebp = async (file: File): Promise<File> => {
        if (file.type === "image/gif") return file;
        if (file.type === "image/webp" && file.size <= 256 * 1024) return file;
        if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") {
            return file;
        }
        try {
            const bitmap = await createImageBitmap(file);
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const ctx = canvas.getContext("2d");
            if (!ctx) return file;
            ctx.drawImage(bitmap, 0, 0);
            const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.92 });
            bitmap.close?.();
            const baseName = file.name.replace(/\.[^.]+$/, "");
            return new File([blob], `${baseName}.webp`, { type: "image/webp" });
        } catch {
            return file;
        }
    };

    const toDataUrl = (file: File): Promise<string> =>
        new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });

    export const addFile = async (file: File) => {
        if (!ACCEPTED.includes(file.type)) {
            onError("Please choose an image file (PNG, JPEG, WebP, or GIF).");
            return;
        }
        if (file.size > MAX_IMAGE_BYTES) {
            onError("That image is too large — keep it under 8 MB.");
            return;
        }
        processing += 1;
        try {
            const sanitized = await reencodeToWebp(file);
            const dataUrl = await toDataUrl(sanitized);
            copilot.addPendingImage(dataUrl);
        } catch {
            onError("Couldn't read that image. Please try a different file.");
        } finally {
            processing -= 1;
        }
    };

    const handleFileSelect = (event: Event) => {
        const input = event.target as HTMLInputElement;
        const files = Array.from(input.files ?? []);
        input.value = "";
        // Subtract in-flight encodes so concurrent selections can't exceed the cap.
        const slots = copilot.maxPendingImages - copilot.pendingImages.length - processing;
        if (files.length > slots) {
            onError(`You can attach up to ${copilot.maxPendingImages} images.`);
        }
        for (const file of files.slice(0, Math.max(slots, 0))) void addFile(file);
    };

    const placeholders = $derived(Array.from({ length: processing }, (_, i) => i));
</script>

<input
    bind:this={fileInput}
    type="file"
    accept={ACCEPTED.join(",")}
    multiple
    onchange={handleFileSelect}
    aria-label="Upload images"
    class="hidden"
/>

{#if copilot.pendingImages.length > 0 || processing > 0}
    <div class="flex flex-wrap items-center gap-1.5 px-1 pt-1 pb-2">
        {#each copilot.pendingImages as image, index (image)}
            <div
                class="border-chat-border-subtle relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-solid"
            >
                <img src={image} alt="Attachment {index + 1}" class="h-full w-full object-cover" />
                <button
                    type="button"
                    onclick={() => copilot.removePendingImage(index)}
                    aria-label="Remove attachment {index + 1}"
                    class="bg-scrim-soft absolute inset-0 flex touch-manipulation items-center justify-center opacity-0 backdrop-blur-[var(--glass-blur-soft)] transition-opacity duration-150 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
                >
                    <X class="text-foreground h-3.5 w-3.5" aria-hidden="true" />
                </button>
            </div>
        {/each}
        {#each placeholders as placeholder (placeholder)}
            <div
                class="border-chat-border-subtle flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-dashed"
            >
                <Loader2 class="text-chat-text-muted h-4 w-4 animate-spin" aria-hidden="true" />
            </div>
        {/each}
    </div>
{/if}
