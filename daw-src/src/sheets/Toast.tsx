import { useEffect, useState } from "react";
import { uiStore } from "../store/project";
import { useStore } from "../store/store";

const VISIBLE_MS = 5000;
/** Matches the toast-out animation in sheets.css. */
const LEAVE_MS = 200;

/** One live region for every message, so screen readers announce toasts and they clear themselves. */
export function ToastRegion() {
  const toast = useStore(uiStore, (s) => s.toast);
  // The last toast stays mounted while it fades out, so it never vanishes in a single frame.
  const [leaving, setLeaving] = useState<typeof toast>(null);
  const [last, setLast] = useState<typeof toast>(toast);
  if (toast !== last) {
    if (!toast && last) setLeaving(last);
    else setLeaving(null);
    setLast(toast);
  }
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLeaving(null), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  useEffect(() => {
    if (!toast) return;
    const id = toast.id;
    // Long messages (errors with a file name) need longer to read.
    const timer = setTimeout(() => uiStore.set((s) => (s.toast?.id === id ? { ...s, toast: null } : s)), Math.max(VISIBLE_MS, toast.text.length * 55));
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <div className="toast-region" role="status" aria-live="polite" aria-atomic="true">
      {leaving && !toast && (
        <div key={leaving.id} className="toast out" aria-hidden="true">
          <span>{leaving.text}</span>
          <span className="toast-close" aria-hidden="true">
            ×
          </span>
        </div>
      )}
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
