<script lang="ts">
    import uploadGif from "#lib/assets/upload.gif";

    interface Props {
        disabled?: boolean;
        needsMerchantId?: boolean;
    }

    let { disabled = false, needsMerchantId = false }: Props = $props();

    const title = $derived(
        needsMerchantId ? "Merchant ID required" : disabled ? "Select a courier first" : "Drop your CSV file here"
    );

    const subtitle = $derived(
        needsMerchantId
            ? "Enter your Merchant ID in the settings above"
            : disabled
              ? "Choose a courier service to enable upload"
              : "or click to browse"
    );
</script>

<div class="flex flex-col items-center justify-center gap-4 px-4 sm:gap-6">
    <img
        src={uploadGif}
        alt="Upload animation"
        class="h-16 w-16 object-contain sm:h-20 sm:w-20 md:h-24 md:w-24"
        class:grayscale={disabled}
    />
    <div class="flex flex-col items-center gap-2 text-center sm:gap-2.5">
        <p
            class="text-foreground text-micro sm:text-caption tracking-[0.28em] text-balance uppercase"
            class:text-ink-muted={disabled}
        >
            {title}
        </p>
        <p class="text-ink-muted text-xs text-pretty sm:text-sm">
            {subtitle}
        </p>
    </div>
</div>
