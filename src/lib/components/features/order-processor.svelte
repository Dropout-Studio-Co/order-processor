<!--
    Ingestion orchestrator: owns the dropzone ↔ editor swap. Parses the dropped
    CSV via processOrders, then mounts OutputEditor in place of the dropzone
    (editorRows !== null is the switch). Retains the raw CSV so the Copilot's
    proposeCsvColumnMapping can re-project it through applyMapping, which re-mounts
    the editor with a corrected batch. Registers an IngestionController with
    copilotBridge (CLAUDE.md #15). Mirrors editor-open state to the `editorOpen`
    bindable so the parent layout can switch stacked ↔ side-by-side.
-->
<script lang="ts">
    import type { SteadFastOrder } from "#lib/types/index.js";
    import { processOrders } from "#lib/services/index.js";
    import { generateFileName } from "#lib/constants/index.js";
    import { brandSettings, hasMerchantId } from "#lib/stores/index.js";
    import { Courier } from "#lib/types/index.js";
    import type { CurrentUser } from "#lib/types/index.js";
    import { cn, parseCSV, normalizePhoneNumber } from "#lib/utils/index.js";
    import { LoadingSpinner } from "#lib/components/index.js";
    import { OutputEditor, type BatchDefaults } from "./output-editor";
    import Upload from "./upload.svelte";
    import { copilotBridge } from "#lib/stores/copilot-bridge.svelte.js";
    import type { CsvMapping, IngestionController } from "#lib/ai/types.js";

    interface Props {
        currentUser: CurrentUser | null;
        selectedCourier: string;
        editorOpen?: boolean;
    }

    let { currentUser, selectedCourier, editorOpen = $bindable(false) }: Props = $props();

    let zoneHover = $state(false);
    let isProcessing = $state(false);
    let error = $state<string | null>(null);
    let fileInputRef = $state<HTMLInputElement | null>(null);

    // Non-null editorRows means the editor is mounted in place of the dropzone.
    let editorRows = $state<SteadFastOrder[] | null>(null);
    let editorDefaults = $state<BatchDefaults | null>(null);
    let editorFileName = $state<string>("");
    // Raw CSV retained so the Copilot's `proposeCsvColumnMapping` can re-project it.
    let lastRawData = $state<string[][] | null>(null);

    const isSteadFast = $derived(selectedCourier === Courier.SteadFast);
    const needsMerchantId = $derived(isSteadFast && !hasMerchantId());
    const isDisabled = $derived(selectedCourier === "" || needsMerchantId);
    const isEditorOpen = $derived(editorRows !== null);

    // Mirror to bindable prop so the parent can swap stack ↔ side-by-side layout.
    $effect(() => {
        editorOpen = isEditorOpen;
    });

    const handleFileSelect = async (file: File) => {
        if (isDisabled) return;

        isProcessing = true;
        error = null;

        try {
            const result = await parseCSV(file);
            if (result.errors.length > 0) {
                console.warn("CSV parsing warnings:", result.errors);
            }
            lastRawData = result.data;

            const settings = brandSettings.value;
            const contactName = settings.contactName ?? currentUser?.name ?? "";
            const contactPhone = settings.contactPhone ?? "";
            const merchantId = settings.merchantId ?? "";

            const processedOrders = processOrders(result.data, {
                name: contactName,
                phone: contactPhone,
                merchantId
            });

            // FR-3: zero-row results still mount the editor (empty grid +
            // populated defaults strip) so the user can add rows manually.
            editorRows = processedOrders;
            editorDefaults = {
                Invoice: merchantId,
                "Contact Name": contactName,
                "Contact Phone": contactPhone,
                "Delivery Type": "Home",
                Lot: ""
            };
            editorFileName = generateFileName(selectedCourier);
        } catch (e) {
            console.error("Processing error:", e);
            error = e instanceof Error ? e.message : "Failed to process file";
        } finally {
            isProcessing = false;
        }
    };

    const handleEditorDiscard = () => {
        editorRows = null;
        editorDefaults = null;
        editorFileName = "";
        lastRawData = null;
        zoneHover = false;
    };

    // Re-projects `lastRawData` through a Copilot-proposed column mapping and
    // re-mounts the editor (via {#key editorRows}) with the corrected batch.
    const applyMapping = (mapping: CsvMapping) => {
        if (!lastRawData) return;
        const body = lastRawData.slice(mapping.skipFirst, lastRawData.length - mapping.skipLast);
        const settings = brandSettings.value;
        const contactName = settings.contactName ?? currentUser?.name ?? "";
        const contactPhone = settings.contactPhone ?? "";
        const merchantId = settings.merchantId ?? "";

        const mapped: SteadFastOrder[] = body
            .filter((row) => {
                const name = (row[mapping.nameIndex] ?? "").trim();
                const phone = (row[mapping.phoneIndex] ?? "").trim();
                return name.length > 0 || phone.length > 0;
            })
            .map((row) => ({
                Invoice: merchantId,
                Name: (row[mapping.nameIndex] ?? "").trim(),
                Address: mapping.addressIndexes
                    .map((i) => (row[i] ?? "").trim())
                    .filter(Boolean)
                    .join(", "),
                Phone: normalizePhoneNumber(row[mapping.phoneIndex] ?? ""),
                Amount: (row[mapping.amountIndex] ?? "").trim(),
                Note: mapping.noteIndex !== null ? (row[mapping.noteIndex] ?? "").trim() : "",
                Lot: "",
                "Delivery Type": "Home",
                "Contact Name": contactName,
                "Contact Phone": contactPhone
            }));

        editorRows = mapped;
        editorDefaults = {
            Invoice: merchantId,
            "Contact Name": contactName,
            "Contact Phone": contactPhone,
            "Delivery Type": "Home",
            Lot: ""
        };
        editorFileName = generateFileName(selectedCourier);
        error = null;
    };

    $effect(() => {
        const controller: IngestionController = {
            getRawCsv: () => (lastRawData ? { headers: lastRawData[0] ?? [], rows: lastRawData.slice(1) } : null),
            applyMapping
        };
        copilotBridge.registerIngestion(controller);
        return () => copilotBridge.unregisterIngestion(controller);
    });

    const handleDragOver = (e: DragEvent) => {
        e.preventDefault();
        if (!isDisabled && !isEditorOpen) zoneHover = true;
    };

    const handleDragLeave = (e: DragEvent) => {
        e.preventDefault();
        zoneHover = false;
    };

    const handleDrop = (e: DragEvent) => {
        e.preventDefault();
        zoneHover = false;
        if (isDisabled || isEditorOpen) return;

        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            const file = files[0];
            if (file && (file.type === "text/csv" || file.name.endsWith(".csv"))) {
                handleFileSelect(file);
            } else {
                error = "Please upload a CSV file";
            }
        }
    };

    const handleClick = () => {
        if (!isDisabled && !isEditorOpen && fileInputRef) {
            fileInputRef.click();
        }
    };

    const handleInputChange = (e: Event) => {
        const input = e.target as HTMLInputElement;
        const files = input.files;
        if (files && files.length > 0) {
            const file = files[0];
            if (file) handleFileSelect(file);
        }
        // Reset value so re-selecting the same file fires `change` again.
        input.value = "";
    };
</script>

<!-- Wrapper persists across the dropzone↔editor swap. The upload keeps its
     deliberate readable cap; the editor removes it so its grid can use all
     available width while retaining its own internal scroll container. -->
<div
    class={cn(
        "w-full min-w-0 transition-[max-width] duration-150 ease-out",
        isEditorOpen ? "max-w-none" : "lg:max-w-md xl:max-w-lg"
    )}
>
    {#if isEditorOpen && editorRows && editorDefaults}
        <!-- Key on rows identity: Copilot re-map (new array ref) re-mounts
             OutputEditor so it re-seeds its $state from the new props. -->
        {#key editorRows}
            <OutputEditor
                initialRows={editorRows}
                initialDefaults={editorDefaults}
                fileName={editorFileName}
                onDiscard={handleEditorDiscard}
            />
        {/key}
    {:else}
        <div
            role="button"
            tabindex={isDisabled ? -1 : 0}
            class={cn(
                "flex w-full touch-manipulation flex-col items-center justify-center rounded-xl border border-dashed transition-all duration-200 ease-[var(--ease)]",
                "h-56 sm:h-64 md:h-72 lg:h-80",
                "ring-offset-background focus-visible:ring-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                isDisabled
                    ? "border-hair cursor-not-allowed opacity-50"
                    : "border-signal/40 bg-ink-2 hover:border-signal/70 hover:bg-ink-800 cursor-pointer",
                zoneHover && "bg-ink-2 border-signal/60",
                error && "border-destructive/60"
            )}
            ondragover={handleDragOver}
            ondragleave={handleDragLeave}
            ondrop={handleDrop}
            onclick={handleClick}
            onkeydown={(e) => e.key === "Enter" && handleClick()}
        >
            <input
                bind:this={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                class="hidden"
                onchange={handleInputChange}
                disabled={isDisabled}
            />

            {#if error}
                <div class="flex flex-col items-center gap-3 px-4 text-center sm:gap-4">
                    <p class="text-destructive text-sm text-pretty sm:text-base">{error}</p>
                    <button
                        onclick={(e) => {
                            e.stopPropagation();
                            error = null;
                        }}
                        class="sleek text-ink-muted hover:bg-ink-2 hover:text-foreground focus-visible:ring-ring border-hair cursor-pointer touch-manipulation rounded-full border border-solid px-5 py-2 text-xs tracking-[0.12em] uppercase focus:outline-none focus-visible:ring-2 active:scale-95"
                    >
                        Try again
                    </button>
                </div>
            {:else if isProcessing}
                <div class="flex flex-col items-center gap-3 sm:gap-4">
                    <LoadingSpinner size="lg" colorClass="border-t-foreground" />
                    <p class="text-ink-muted text-micro tracking-[0.28em] uppercase">Processing</p>
                </div>
            {:else}
                <Upload disabled={isDisabled} {needsMerchantId} />
            {/if}
        </div>
    {/if}
</div>
