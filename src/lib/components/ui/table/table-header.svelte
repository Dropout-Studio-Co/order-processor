<script lang="ts">
    import { cn, type WithElementRef } from "#lib/utils/index.js";
    import type { HTMLAttributes } from "svelte/elements";

    let {
        ref = $bindable(null),
        class: className,
        children,
        ...restProps
    }: WithElementRef<HTMLAttributes<HTMLTableSectionElement>, HTMLTableSectionElement> = $props();
</script>

<thead
    bind:this={ref}
    data-slot="table-header"
    class={cn("bg-muted/50 [&_tr]:border-border [&_tr]:border-b [&_tr]:border-solid", className)}
    {...restProps}
>
    {@render children?.()}
</thead>
