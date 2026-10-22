import { uiStore, type UiState } from "../store/project";
import { createStore } from "../store/store";

export type ChoiceTone = "primary" | "secondary" | "danger";

export interface Choice {
  id: string;
  label: string;
  tone?: ChoiceTone;
}

export interface PromptField {
  label: string;
  initial?: string;
  placeholder?: string;
  /** Returns an error message to show and block the answer, or null when the text is fine. */
  validate?(text: string): string | null;
}

export interface SheetRequest {
  id: number;
  title: string;
  message?: string;
  icon: "warn" | "info" | "danger";
  choices: Choice[];
  cancelLabel: string;
  field?: PromptField;
  resolve(answer: { choice: string; text: string } | null): void;
}

interface Queue {
  requests: SheetRequest[];
}

/** What the confirm sheet shows. Requests wait their turn, so two callers never overwrite each other's question. */
export const confirmQueue = createStore<Queue>({ requests: [] });

let counter = 0;
let sheetBefore: UiState["sheet"] = null;

function open(request: SheetRequest): void {
  if (confirmQueue.get().requests.length === 0) sheetBefore = uiStore.get().sheet;
  confirmQueue.set((q) => ({ requests: [...q.requests, request] }));
  uiStore.set((s) => ({ ...s, sheet: "confirm" }));
}

/** Called by the sheet when the user answers; null means cancelled. */
export function answerRequest(id: number, answer: { choice: string; text: string } | null): void {
  const request = confirmQueue.get().requests.find((r) => r.id === id);
  if (!request) return;
  confirmQueue.set((q) => ({ requests: q.requests.filter((r) => r.id !== id) }));
  if (confirmQueue.get().requests.length === 0 && uiStore.get().sheet === "confirm") {
    uiStore.set((s) => ({ ...s, sheet: sheetBefore === "confirm" ? null : sheetBefore }));
  }
  request.resolve(answer);
}

export interface ChoiceOptions {
  title: string;
  message?: string;
  icon?: SheetRequest["icon"];
  choices: Choice[];
  cancelLabel?: string;
}

/** A question with several answers. Resolves with the chosen id, or null when cancelled. */
export function choiceSheet(options: ChoiceOptions): Promise<string | null> {
  return new Promise((resolve) => {
    counter += 1;
    open({
      id: counter,
      title: options.title,
      message: options.message,
      icon: options.icon ?? "warn",
      choices: options.choices,
      cancelLabel: options.cancelLabel ?? "Cancel",
      resolve: (answer) => resolve(answer ? answer.choice : null),
    });
  });
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Use for anything that deletes or cannot be undone. */
  danger?: boolean;
}

/** Replaces window.confirm. Resolves true only when the user presses the confirm button. */
export async function confirmSheet(options: ConfirmOptions): Promise<boolean> {
  const answer = await choiceSheet({
    title: options.title,
    message: options.message,
    icon: options.danger ? "danger" : "warn",
    cancelLabel: options.cancelLabel,
    choices: [{ id: "confirm", label: options.confirmLabel ?? "Continue", tone: options.danger ? "danger" : "primary" }],
  });
  return answer === "confirm";
}

export interface PromptOptions {
  title: string;
  message?: string;
  label: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  validate?(text: string): string | null;
}

/** Replaces window.prompt. Resolves with the text the user entered, or null when cancelled. */
export function promptSheet(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    counter += 1;
    open({
      id: counter,
      title: options.title,
      message: options.message,
      icon: "info",
      choices: [{ id: "ok", label: options.confirmLabel ?? "Save", tone: "primary" }],
      cancelLabel: options.cancelLabel ?? "Cancel",
      field: { label: options.label, initial: options.initial, placeholder: options.placeholder, validate: options.validate },
      resolve: (answer) => resolve(answer ? answer.text : null),
    });
  });
}
