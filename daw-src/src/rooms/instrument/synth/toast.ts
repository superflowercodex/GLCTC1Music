import { uiStore } from "../../../store/project";

export function showToast(text: string): void {
  uiStore.set((s) => ({ ...s, toast: { id: Date.now(), text } }));
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
