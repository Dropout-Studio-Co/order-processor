<script lang="ts">
    import { CHANGELOG_ENTRIES, type ChangelogEntry } from "#lib/data/changelog.js";
    import { reveal } from "#lib/motion/index.js";
    import { Heading, Eyebrow } from "#lib/ds/index.js";

    type ChangelogGroup = {
        date: string;
        label: string;
        entries: ChangelogEntry[];
    };

    // Absolute dates only — formatting "x days ago" client-side would mismatch the
    // server render and trip hydration (see changelog.ts header).
    const dateFormatter = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric" });

    function formatDate(iso: string): string {
        // Parse as UTC midnight so the displayed day never shifts by timezone.
        return dateFormatter.format(new Date(`${iso}T00:00:00Z`));
    }

    // Entries arrive newest-first; fold consecutive same-date entries into one group
    // so each calendar day renders under a single header.
    function groupByDate(entries: ChangelogEntry[]): ChangelogGroup[] {
        const groups: ChangelogGroup[] = [];
        for (const entry of entries) {
            const last = groups.at(-1);
            if (last && last.date === entry.date) {
                last.entries.push(entry);
            } else {
                groups.push({ date: entry.date, label: formatDate(entry.date), entries: [entry] });
            }
        }
        return groups;
    }

    const groups = groupByDate(CHANGELOG_ENTRIES);
</script>

<svelte:head>
    <title>Changelog · Shopify Order Processor</title>
    <meta
        name="description"
        content="What's new in Shopify Order Processor — a plain-language history of features, improvements, and fixes."
    />
</svelte:head>

<main class="mx-auto w-full max-w-2xl px-4 py-14 sm:px-6 sm:py-20">
    <header class="flex flex-col gap-4 sm:gap-5" use:reveal={{ distance: "sm" }}>
        <Eyebrow>What's new</Eyebrow>
        <Heading as="h1" size="title" weight={600} class="lowercase">changelog</Heading>
        <p class="text-ink-muted text-label sm:text-body max-w-md text-pretty">
            Every meaningful update to Order Processor, written in plain language.
        </p>
    </header>

    <div class="border-hair my-12 border-t sm:my-16"></div>

    <div class="flex flex-col gap-14 sm:gap-20">
        {#each groups as group, groupIndex (group.date)}
            <section class="flex flex-col gap-6">
                <div
                    class="flex flex-wrap items-baseline gap-x-3 gap-y-1.5"
                    use:reveal={{ distance: "sm", delay: groupIndex === 0 ? 0.05 : 0 }}
                >
                    <span class="text-ink-muted text-micro tracking-[0.28em] uppercase tabular-nums">
                        {group.label}
                    </span>
                    {#if groupIndex === 0}
                        <span
                            class="border-hair text-ink-muted text-micro rounded-full border px-2 py-0.5 tracking-[0.18em] whitespace-nowrap uppercase"
                        >
                            Latest
                        </span>
                    {/if}
                </div>

                <div class="border-hair flex flex-col gap-8 border-l pl-5 sm:pl-6">
                    {#each group.entries as entry, entryIndex (entry.title)}
                        <article
                            class="flex flex-col gap-2.5"
                            use:reveal={{ distance: "sm", delay: 0.06 * entryIndex }}
                        >
                            <span class="text-ink-muted text-micro block tracking-[0.22em] uppercase">
                                {entry.category}
                            </span>
                            <Heading as="h2" size="lead" class="text-balance">
                                {entry.title}
                            </Heading>
                            <p class="text-ink-muted text-label leading-relaxed text-pretty">
                                {entry.summary}
                            </p>
                        </article>
                    {/each}
                </div>
            </section>
        {/each}
    </div>
</main>
