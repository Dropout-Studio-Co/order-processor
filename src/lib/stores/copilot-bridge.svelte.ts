/**
 * Bridge between the output editor and the Copilot. The editor publishes an
 * `EditorController` (closures over its own `$state`) on mount; `OrderProcessor`
 * publishes an `IngestionController` for raw-CSV access. The Copilot's tool
 * executor consumes whatever is currently registered — both are null before a
 * CSV is loaded, so grid tools fail gracefully.
 *
 * `unregister*` is identity-checked so a fast editor remount (new CSV drop)
 * that registers a fresh controller is not clobbered by the old one's teardown.
 */
import type { EditorController, IngestionController } from "#lib/ai/types.js";

const createBridge = () => {
    let editor = $state<EditorController | null>(null);
    let ingestion = $state<IngestionController | null>(null);

    return {
        get editor() {
            return editor;
        },
        get ingestion() {
            return ingestion;
        },
        registerEditor(controller: EditorController) {
            editor = controller;
        },
        unregisterEditor(controller: EditorController) {
            if (editor === controller) editor = null;
        },
        registerIngestion(controller: IngestionController) {
            ingestion = controller;
        },
        unregisterIngestion(controller: IngestionController) {
            if (ingestion === controller) ingestion = null;
        }
    };
};

export const copilotBridge = createBridge();
