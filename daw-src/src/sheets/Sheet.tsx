import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/** Keeps Tab and Shift+Tab inside the dialog. Returns true when it handled the key. */
export function trapTab(event: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">, container: HTMLElement): boolean {
  if (event.key !== "Tab") return false;
  const items = focusables(container);
  if (items.length === 0) {
    event.preventDefault();
    container.focus();
    return true;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !container.contains(active))) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && (active === last || !container.contains(active))) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

/**
 * The frame every sheet shares: a modal dialog that traps focus, closes on Escape or a click on the
 * backdrop, and puts focus back where it was when it closes.
 */
export function Sheet({
  title,
  subtitle,
  onClose,
  width = 560,
  placement = "center",
  hideHead = false,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  width?: number;
  placement?: "center" | "top";
  /** The palette and confirm sheets draw their own heading. */
  hideHead?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    if (dialog) (dialog.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(dialog)[0] ?? dialog).focus();
    return () => {
      if (before && document.contains(before)) before.focus();
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      closeRef.current();
      return;
    }
    if (ref.current) trapTab(e, ref.current);
  };

  return (
    <div
      className={`sheet-overlay ${placement}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) closeRef.current();
      }}
    >
      <div ref={ref} className="sheet" style={{ "--w": `${width}px` } as React.CSSProperties} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
        <h2 id={titleId} className={hideHead ? "sr-only" : "sheet-title"}>
          {title}
          {!hideHead && subtitle && <span className="sheet-sub">{subtitle}</span>}
        </h2>
        {children}
      </div>
    </div>
  );
}
