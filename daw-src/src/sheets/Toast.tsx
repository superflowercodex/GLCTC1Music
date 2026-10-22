import { useEffect } from "react";
import { uiStore } from "../store/project";
import { useStore } from "../store/store";

const VISIBLE_MS = 5000;

/** One live region for every message, so screen readers announce toasts and they clear themselves. */
export function ToastRegion() {
  const toast = useStore(uiStore, (s) => s.toast);

  useEffect(() => {
    if (!toast) return;
    const id = toast.id;
    // Long messages (errors with a file name) need longer to read.
    const timer = setTimeout(() => uiStore.set((s) => (s.toast?.id === id ? { ...s, toast: null } : s)), Math.max(VISIBLE_MS, toast.text.length * 55));
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <div className="toast-region" role="status" aria-live="polite" aria-atomic="true">
      {toast && (
        <div key={toast.id} className="toast">
          <span>{toast.text}</span>
          <button type="button" className="toast-close" aria-label="Dismiss message" onClick={() => uiStore.set((s) => ({ ...s, toast: null }))}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
