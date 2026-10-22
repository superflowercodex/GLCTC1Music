import { uiStore } from "../../../store/project";

/** Failures must reach the person, so engines and rooms report through the shared toast. */
export function notify(text: string): void {
  uiStore.set((s) => ({ ...s, toast: { id: Date.now(), text } }));
}
