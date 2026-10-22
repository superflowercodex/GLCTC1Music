import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { trapTab } from "../../sheets/Sheet";
import "./clipModal.css";

/**
 * The clip editor as a dialog over the arrangement: a soft scrim, one frosted surface, focus kept inside
 * and handed back to the clip on close. Escape, the scrim and the editor's own close keys dismiss it.
 * Playback is untouched, so the song keeps running underneath.
 */
export function ClipModal({ clipId, label, onClose, children }: { clipId: string; label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    dialog?.focus();
    return () => {
      // Back to the clip that was opened (it may have moved track, so look it up again).
      document.querySelector<HTMLElement>(`[data-clip="${clipId}"]`)?.focus();
    };
  }, [clipId]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close.current();
      return;
    }
    if (ref.current) trapTab(e, ref.current);
  };

  return createPortal(
    <div
      className="ce-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close.current();
      }}
    >
      <div ref={ref} className="ce-modal frost-pop" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} onKeyDown={onKeyDown}>
        {children}
      </div>
    </div>,
    // Inside the shell, like the sheets, so the project's colours (--a1...) still apply.
    document.querySelector(".shell") ?? document.body,
  );
}
