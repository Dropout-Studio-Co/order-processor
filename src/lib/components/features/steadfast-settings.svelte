<!--
    Per-user SteadFast brand settings form (contact name/phone + required merchant
    ID). Writes directly to the brandSettings store, which debounces a PATCH with
    per-field save state (the indicator/errorMessage snippets read fieldState/
    fieldError). The beforeunload guard blocks navigation while a save is in flight
    so an in-progress PATCH is not lost.
-->
<script lang="ts">
    import { brandSettings } from "$lib/stores";
    import { Input } from "$lib/components/ui/input";
    import { Eyebrow, labelBase } from "$lib/ds";
    import { Loader2, AlertCircle } from "@lucide/svelte";

    interface Props {
        visible: boolean;
    }

    let { visible }: Props = $props();

    const contactName = $derived(brandSettings.value.contactName ?? "");
    const contactPhone = $derived(brandSettings.value.contactPhone ?? "");
    const merchantId = $derived(brandSettings.value.merchantId ?? "");

    // Invalid only when the user has actually cleared it: null = not yet
    // hydrated/never touched (no error shown), "" = explicitly emptied.
    const merchantIdInvalid = $derived(
        brandSettings.value.merchantId !== null && brandSettings.value.merchantId.trim().length === 0
    );

    $effect(() => {
        const handler = (e: BeforeUnloadEvent) => {
            if (brandSettings.saveState === "saving") {
                e.preventDefault();
                e.returnValue = "";
            }
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    });

    const onContactName = (e: Event) => {
        brandSettings.updateField("contactName", (e.currentTarget as HTMLInputElement).value);
    };
    const onContactPhone = (e: Event) => {
        brandSettings.updateField("contactPhone", (e.currentTarget as HTMLInputElement).value);
    };
    const onMerchantId = (e: Event) => {
        brandSettings.updateField("merchantId", (e.currentTarget as HTMLInputElement).value);
    };
</script>

{#snippet indicator(field: "contactName" | "contactPhone" | "merchantId")}
    {@const state = brandSettings.fieldState(field)}
    <div class="pointer-events-none absolute inset-y-0 right-3 flex items-center" aria-live="polite" aria-atomic="true">
        {#if state === "saving" || state === "saved"}
            <Loader2
                class="text-signal h-3.5 w-3.5 animate-spin"
                aria-label={state === "saving" ? "Saving" : "Saved"}
            />
        {:else if state === "error"}
            <AlertCircle class="text-destructive h-3.5 w-3.5" aria-label="Save failed" />
        {/if}
    </div>
{/snippet}

{#snippet errorMessage(field: "contactName" | "contactPhone" | "merchantId")}
    {@const err = brandSettings.fieldError(field)}
    {#if err}
        <p class="text-destructive mt-1 flex items-center gap-2 text-xs">
            <span class="text-pretty">{err}</span>
            <button
                type="button"
                onclick={() => brandSettings.dismissError(field)}
                class="text-ink-muted hover:text-foreground focus-visible:outline-signal cursor-pointer touch-manipulation rounded underline transition-colors ease-[var(--ease)] focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
            >
                Dismiss
            </button>
        </p>
    {/if}
{/snippet}

{#if visible}
    <div class="animate-in fade-in slide-in-from-top-2 w-full max-w-sm duration-300">
        <div class="mb-4 flex items-center gap-3">
            <div class="bg-hair h-px flex-1"></div>
            <Eyebrow as="span" class="text-micro whitespace-nowrap">SteadFast Settings</Eyebrow>
            <div class="bg-hair h-px flex-1"></div>
        </div>

        <div class="sleek border-hair bg-card rounded-xl border border-solid p-4 shadow-sm">
            <div class="space-y-4">
                <div>
                    <label for="contact-name" class={labelBase}>
                        Contact Name <span class="text-ink-muted/70 normal-case">(optional)</span>
                    </label>
                    <div class="relative">
                        <Input
                            id="contact-name"
                            value={contactName}
                            placeholder="e.g., Lord Voldemort"
                            class="pr-9"
                            oninput={onContactName}
                        />
                        {@render indicator("contactName")}
                    </div>
                    {@render errorMessage("contactName")}
                </div>

                <div>
                    <label for="contact-phone" class={labelBase}>
                        Contact Phone <span class="text-ink-muted/70 normal-case">(optional)</span>
                    </label>
                    <div class="relative">
                        <Input
                            id="contact-phone"
                            type="tel"
                            value={contactPhone}
                            placeholder="e.g., 1XXXXXXXXX"
                            class="pr-9 tabular-nums"
                            oninput={onContactPhone}
                        />
                        {@render indicator("contactPhone")}
                    </div>
                    {@render errorMessage("contactPhone")}
                </div>

                <div>
                    <label for="merchant-id" class={labelBase}>
                        Merchant ID <span class="text-destructive">*</span>
                    </label>
                    <div class="relative">
                        <Input
                            id="merchant-id"
                            value={merchantId}
                            placeholder="e.g., 123456"
                            error={merchantIdInvalid}
                            class="pr-9 tabular-nums"
                            oninput={onMerchantId}
                        />
                        {@render indicator("merchantId")}
                    </div>
                    {#if merchantIdInvalid}
                        <p class="text-destructive mt-1 text-xs">Merchant ID is required</p>
                    {/if}
                    {@render errorMessage("merchantId")}
                </div>
            </div>
        </div>

        <p class="text-ink-muted mt-3 text-center text-xs text-pretty">Your personal SteadFast delivery settings</p>
    </div>
{/if}
