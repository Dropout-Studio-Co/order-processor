<script lang="ts">
    import { Eyebrow } from "#lib/ds/index.js";
    import { Input } from "#lib/components/ui/input/index.js";
    import { cn } from "#lib/utils/index.js";
    import { BATCH_CONSTANT_COLUMNS, type BatchDefaults } from "./columns";

    interface Props {
        defaults: BatchDefaults;
        overrideCountByColumn: Record<keyof BatchDefaults, number>;
        onUpdate: (field: keyof BatchDefaults, value: string) => void;
        onResetOverrides: (field: keyof BatchDefaults) => void;
    }

    let { defaults, overrideCountByColumn, onUpdate, onResetOverrides }: Props = $props();
</script>

<section aria-label="Batch defaults" class="border-hair bg-card rounded-xl border border-solid p-3 sm:p-4">
    <div class="mb-3 flex items-center justify-between gap-3">
        <Eyebrow as="h2">Batch defaults</Eyebrow>
        <p class="text-ink-muted text-caption text-pretty">Applies to every row · not saved to your brand settings</p>
    </div>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {#each BATCH_CONSTANT_COLUMNS as column (column.key)}
            {@const fieldKey = column.key as keyof BatchDefaults}
            {@const overrides = overrideCountByColumn[fieldKey] ?? 0}
            <div class="flex flex-col">
                <div class="mb-1.5 flex items-center gap-1.5">
                    <label for="strip-{column.key}" class="text-ink-muted text-micro tracking-[0.12em] uppercase">
                        {column.key}
                    </label>
                    {#if overrides > 0}
                        <span
                            class="bg-signal inline-block h-1.5 w-1.5 rounded-full"
                            title="{overrides} row override{overrides === 1 ? '' : 's'}"
                            aria-label="{overrides} row{overrides === 1 ? '' : 's'} have an override"
                        ></span>
                    {/if}
                </div>
                <Input
                    id="strip-{column.key}"
                    type={column.inputmode === "tel" ? "tel" : "text"}
                    value={defaults[fieldKey] ?? ""}
                    oninput={(e) => onUpdate(fieldKey, (e.currentTarget as HTMLInputElement).value)}
                    class="bg-background"
                />
                {#if overrides > 0}
                    <button
                        type="button"
                        onclick={() => onResetOverrides(fieldKey)}
                        class={cn(
                            "text-ink-muted hover:text-foreground text-micro mt-1 cursor-pointer touch-manipulation self-start py-2  tracking-[0.1em] whitespace-nowrap uppercase underline-offset-2 hover:underline sm:py-1",
                            "focus-visible:ring-ring focus:outline-none focus-visible:ring-2"
                        )}
                    >
                        Reset {overrides} override{overrides === 1 ? "" : "s"}
                    </button>
                {/if}
            </div>
        {/each}
    </div>
</section>
