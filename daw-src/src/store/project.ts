import { newProject, type Project } from "../project/model";
import { createStore } from "./store";

/** The open project. Edit it through immutable updates: projectStore.set((p) => ({ ...p, bpm })). */
export const projectStore = createStore<Project>(newProject());

/** UI-only state that is not saved with the project. */
export interface UiState {
  selectedClipId: string | null;
  selectedTrackId: string | null;
  /** Which instrument slot the instrument rooms show. */
  activeSlotId: string | null;
  toast: { id: number; text: string } | null;
  sheet: null | "record" | "export" | "palette" | "shortcuts" | "confirm" | "performance";
}

export const uiStore = createStore<UiState>({
  selectedClipId: null,
  selectedTrackId: null,
  activeSlotId: null,
  toast: null,
  sheet: null,
});
