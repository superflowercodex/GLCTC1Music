import { useEffect } from "react";
import { togglePlay } from "../../audio/transport";
import { redo, undo } from "../../project/history";
import { uiStore } from "../../store/project";
import { copySelected, cutSelected, deleteSelected, duplicateSelected, nudgeSelected, pasteAtPlayhead, selectAllClips, splitAtPlayhead } from "./ops";
import { selectClips, selectionStore } from "./selection";

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

/**
 * Shortcuts that only make sense while Arrange is on screen. An event another layer already
 * handled (defaultPrevented) is left alone, so the app-wide shortcuts and these never double up.
 */
export function useArrangeKeys(onEscape: () => boolean): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || typing(e.target) || uiStore.get().sheet !== null) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const run = (fn: () => void): void => {
        e.preventDefault();
        fn();
      };

      if (mod) {
        if (key === "z") return run(e.shiftKey ? () => redo() : () => undo());
        if (key === "y") return run(() => redo());
        if (key === "d") return run(duplicateSelected);
        if (key === "c") return run(copySelected);
        if (key === "x") return run(cutSelected);
        if (key === "v") return run(pasteAtPlayhead);
        if (key === "a") return run(selectAllClips);
        return;
      }
      if (e.altKey) return;
      if (e.key === " ") return run(() => void togglePlay());
      if (key === "s") return run(splitAtPlayhead);
      if (e.key === "Delete" || e.key === "Backspace") return run(deleteSelected);
      if (e.key === "ArrowLeft" && selectionStore.get().ids.length > 0) return run(() => nudgeSelected(-1));
      if (e.key === "ArrowRight" && selectionStore.get().ids.length > 0) return run(() => nudgeSelected(1));
      if (e.key === "Escape") {
        if (!onEscape() && selectionStore.get().ids.length > 0) run(() => selectClips([]));
      }
    };
    // Space on a focused button would also click it on key-up.
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === " " && !typing(e.target) && uiStore.get().sheet === null) e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [onEscape]);
}
