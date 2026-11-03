<script lang="ts">
    import { cn } from "#lib/utils/index.js";

    type Size = "sm" | "md" | "lg";

    interface Props {
        size?: Size;
        colorClass?: string;
        class?: string;
    }

    const sizeClasses: Record<Size, string> = {
        sm: "h-4 w-4",
        md: "h-5 w-5",
        lg: "h-6 w-6"
    };

    let { size = "md", colorClass = "border-t-muted-foreground", class: className = "" }: Props = $props();
</script>

<div
    class={cn(
        "border-border-strong animate-spin rounded-full border-2 border-solid",
        sizeClasses[size],
        colorClass,
        className
    )}
    role="status"
    aria-label="Loading"
>
    <span class="sr-only">Loading...</span>
</div>
