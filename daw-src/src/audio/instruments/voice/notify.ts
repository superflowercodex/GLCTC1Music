import { uiStore } from "../../../store/project";

export function toast(text: string): void {
  uiStore.set((s) => ({ ...s, toast: { id: Date.now(), text } }));
}

/** Errors that reach the user must read as sentences, so only our own error classes show their message verbatim. */
export function toastError(error: unknown, fallback: string): void {
  toast(error instanceof Error && error.message ? error.message : fallback);
}
