<script lang="ts">
    import { cn, type WithElementRef } from "#lib/utils/index.js";
    import type { HTMLAttributes } from "svelte/elements";

    let {
        ref = $bindable(null),
        class: className,
        children,
        ...restProps
    }: WithElementRef<HTMLAttributes<HTMLTableRowElement>, HTMLTableRowElement> = $props();
</script>

<tr
    bind:this={ref}
    data-slot="table-row"
    class={cn(
        "border-border hover:bg-muted/40 data-[state=selected]:bg-secondary/60 border-b border-solid transition-colors",
        className
    )}
    {...restProps}
>
    {@render children?.()}
</tr>
