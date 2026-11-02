/**
 * Shared Copilot contracts. Architecture split: `/api/copilot/chat` is
 * stateless and only *decides* tool calls; the browser *executes* them via
 * `executor.ts` against editor `$state`. `Frame` is the SSE wire protocol;
 * everything else here is client-side state.
 */
import type { SteadFastOrder } from "$lib/types";
import type { CellWarning, WarningCode } from "$lib/utils";
import type { BatchDefaults, CellColumn } from "$lib/components/features/output-editor/columns";

/* ── Tool catalog ─────────────────────────────────────────────────────────── */

export const TOOL_NAMES = [
    "getBatchSummary",
    "getRows",
    "flagAnomalies",
    "editCells",
    "setBatchDefaults",
    "addRows",
    "deleteRows",
    "autoFixWarnings",
    "updateBrandSettings",
    "proposeCsvColumnMapping",
    "undoLastChange"
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** Tools that never mutate state — always safe to run without confirmation. */
export const READ_ONLY_TOOLS = new Set<ToolName>(["getBatchSummary", "getRows", "flagAnomalies"]);

export interface ToolCatalogEntry {
    name: ToolName;
    description: string;
    parameters: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
    };
}

/* ── Wire protocol (server → client, SSE) ─────────────────────────────────── */

export type Frame =
    | { t: "text"; delta: string }
    | { t: "tool_call"; id: string; name: string; args: unknown }
    | { t: "end"; turnId: string; conversationId?: string | undefined }
    | { t: "error"; message: string };

export interface ParsedToolCall {
    id: string;
    name: string;
    args: unknown;
}

export interface RawChatResult {
    text: string;
    toolCalls: ParsedToolCall[];
}

export interface ChatHistoryMessage {
    role: "user" | "assistant";
    content: string;
}

export interface ChatRequestBody {
    /** D1 conversation id to persist this turn under; null/omitted creates one. */
    conversationId?: string | null;
    /** Prior turns of the active conversation (the model flow stays stateless). */
    messages: ChatHistoryMessage[];
    /** Pre-rendered CURRENT STATE block — the client owns editor state. */
    contextText: string;
    /** Optional image data-URLs for vision turns (max 3); sent natively as `image_url` parts. */
    images?: string[];
}

/* ── Client message model ─────────────────────────────────────────────────── */

export type ToolCallStatus = "pending" | "pending_confirmation" | "applied" | "rejected" | "failed";

export interface CopilotToolCall {
    id: string;
    name: string;
    args: unknown;
    status: ToolCallStatus;
    /** One-line outcome shown on the tool card once resolved. */
    summary: string | null;
    error: string | null;
    anomalies: AnomalyResult[];
    /** Links to an `AiUndoEntry` once applied; null for read-only tools. */
    undoId: string | null;
    undone: boolean;
}

export interface CopilotMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    toolCalls: CopilotToolCall[];
    createdAt: string;
    streaming: boolean;
    /** Data-URL previews when the user attached images to this turn (max 3). */
    images?: string[];
}

export interface Conversation {
    id: string;
    title: string;
    createdAt: string;
    updatedAt?: string;
    messages: CopilotMessage[];
    /** True once this conversation exists as a row in D1. */
    persisted: boolean;
    /** True once messages have been fetched from D1 (or it was created locally). */
    loaded: boolean;
}

/** Conversation summary hydrated from D1 on page load (no messages yet). */
export interface PersistedConversationSummary {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
}

/** A single persisted message row hydrated from D1 for a conversation. */
export interface PersistedMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    toolCalls: Array<{ id: string; name: string; args: unknown }> | null;
    createdAt: string;
}

/* ── Safety / anomaly detection ───────────────────────────────────────────── */

export type AnomalyKind =
    "amount_outlier" | "short_address" | "cancellation_language" | "landline_phone" | "duplicate_recipient";

export interface AnomalyResult {
    kind: AnomalyKind;
    rowIndex: number;
    reason: string;
}

/* ── Confirmation flow ────────────────────────────────────────────────────── */

export interface ConfirmationDiffRow {
    label: string;
    current: string;
    proposed: string;
}

export interface PendingConfirmation {
    toolCallId: string;
    toolName: string;
    humanLabel: string;
    diff: ConfirmationDiffRow[];
    anomalies: AnomalyResult[];
    inverseSummary: string;
    resolve: (approved: boolean) => void;
}

/* ── AI-owned undo (separate from the editor's native Cmd+Z) ──────────────── */

export interface AiUndoEntry {
    id: string;
    label: string;
    /** Restores editor state to the snapshot taken before the action. */
    revert: () => void;
    undone: boolean;
}

/* ── Editor bridge contracts ──────────────────────────────────────────────── */

export interface CellEdit {
    rowIndex: number;
    column: CellColumn;
    value: string;
}

export interface EditorSnapshot {
    rows: SteadFastOrder[];
    rowIds: string[];
    defaults: BatchDefaults;
}

/**
 * Surface published into `copilotBridge` by output-editor. All mutations must
 * keep `rowIds` lockstep with `rows`; validation re-runs via $derived.
 * Null until output-editor mounts — executor.ts maps absence to a friendly
 * "upload a CSV first" error.
 */
export interface EditorController {
    getRows(): SteadFastOrder[];
    getDefaults(): BatchDefaults;
    getWarnings(): CellWarning[];
    getFileName(): string;
    snapshot(): EditorSnapshot;
    restore(snap: EditorSnapshot): void;
    applyCellEdits(edits: CellEdit[]): void;
    addRows(rows: Partial<SteadFastOrder>[]): void;
    deleteRows(indexes: number[]): void;
    setDefaults(patch: Partial<BatchDefaults>): void;
}

export interface RawCsv {
    headers: string[];
    rows: string[][];
}

export interface CsvMapping {
    nameIndex: number;
    addressIndexes: number[];
    phoneIndex: number;
    amountIndex: number;
    noteIndex: number | null;
    skipFirst: number;
    skipLast: number;
}

/** Published by order-processor.svelte for `proposeCsvColumnMapping`. */
export interface IngestionController {
    getRawCsv(): RawCsv | null;
    applyMapping(mapping: CsvMapping): void;
}

export type { CellWarning, WarningCode, SteadFastOrder, BatchDefaults, CellColumn };
