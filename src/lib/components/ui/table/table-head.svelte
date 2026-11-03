<script lang="ts">
    import { cn, type WithElementRef } from "#lib/utils/index.js";
    import type { HTMLThAttributes } from "svelte/elements";

    let {
        ref = $bindable(null),
        class: className,
        children,
        ...restProps
    }: WithElementRef<HTMLThAttributes, HTMLTableCellElement> = $props();
</script>

<th
    bind:this={ref}
    data-slot="table-head"
    class={cn(
        "text-muted-foreground h-10 px-2 text-left align-middle text-xs font-medium tracking-wide whitespace-nowrap uppercase [&:has([role=checkbox])]:pr-0",
        className
    )}
    {...restProps}
>
    {@render children?.()}
</th>
