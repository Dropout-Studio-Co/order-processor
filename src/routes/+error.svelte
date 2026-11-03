<script lang="ts">
    import { page } from "$app/state";
    import { goto } from "$app/navigation";
    import { Button } from "#lib/components/index.js";
</script>

<div class="flex min-h-dvh flex-col items-center justify-center gap-8 p-4">
    <div class="flex flex-col items-center gap-4 text-center">
        <p class="text-destructive text-6xl font-semibold tabular-nums" aria-label="HTTP status code {page.status}">
            {page.status}
        </p>
        <h1 class="text-foreground text-2xl font-semibold text-balance">
            {page.error?.message || "Something went wrong"}
        </h1>
        <p class="text-muted-foreground max-w-md text-pretty">
            An unexpected error occurred. Please try again or contact support if the problem persists.
        </p>
    </div>

    <Button onclick={() => goto("/")} variant="outline">Go back home</Button>
</div>
