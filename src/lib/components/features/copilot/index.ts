// Barrel for the Copilot UI. Only the entry points the rest of the app mounts
// directly are re-exported here (the rail, the mobile launcher/sheet, and the
// global confirm dialog). Internal children are imported by relative path.
export { default as CopilotSidebar } from "./copilot-sidebar.svelte";
export { default as CopilotMobileFab } from "./copilot-mobile-fab.svelte";
export { default as CopilotDesktopLauncher } from "./copilot-desktop-launcher.svelte";
export { default as CopilotMobileSheet } from "./copilot-mobile-sheet.svelte";
export { default as CopilotConfirmDialog } from "./copilot-confirm-dialog.svelte";
