import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { holdHistory } from "../../project/history";
import { FINE_FACTOR } from "../../ui/kitMath";

interface Props {
  label: string;
  /** 0..1 along the travel. */
  pos: number;
  valueText: string;
  /** Lights from the centre instead of from the left (pan). */
  bipolar?: boolean;
  className?: string;
  /** A new position from a drag, click or wheel; `fine` is true while Shift is held. */
  onPos: (pos: number, dragging: boolean) => void;
  onStep: (direction: 1 | -1, fine: boolean) => void;
  onHome: () => void;
  onEnd: () => void;
  onReset: () => void;
  /** Tells the header to show the live readout (or null to hide it). */
  onReadout: (text: string | null) => void;
}

/**
 * A lean slider for a track header: a thin rail lit in the track colour up to an outlined glass handle.
 * Click jumps, drag moves (Shift for fine), arrows step, wheel nudges while focused, double-click resets.
 * One gesture is one undo step.
 */
export function HeadSlider({ label, pos, valueText, bipolar, className = "", onPos, onStep, onHome, onEnd, onReset, onReadout }: Props) {
  const rail = useRef<HTMLDivElement>(null);
  const live = useRef({ pos, onStep, onReadout, valueText });
  live.current = { pos, onStep, onReadout, valueText };
  const active = useRef(false);

  useEffect(() => {
    if (active.current || document.activeElement === rail.current) onReadout(valueText);
  }, [valueText, onReadout]);

  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    // Only while focused, so scrolling the track list over a header never moves a level by accident.
    const onWheel = (e: WheelEvent) => {
      if (document.activeElement !== el) return;
      e.preventDefault();
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : -e.deltaY;
      if (d !== 0) live.current.onStep(d > 0 ? 1 : -1, e.shiftKey);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const posAt = (clientX: number): number => {
    const r = rail.current?.getBoundingClientRect();
    if (!r || r.width === 0) return pos;
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.focus();
    el.setPointerCapture(e.pointerId);
    el.dataset.drag = "";
    const release = holdHistory();
    const width = el.getBoundingClientRect().width || 1;
    const onHandle = (e.target as HTMLElement).classList.contains("hs-handle");
    let base = onHandle ? pos : posAt(e.clientX);
    let x0 = e.clientX;
    let fine = e.shiftKey;
    active.current = true;
    if (!onHandle) onPos(base, true);
    onReadout(live.current.valueText);
    const move = (ev: globalThis.PointerEvent) => {
      // Re-anchor when Shift changes, so switching to fine never jumps the handle.
      if (ev.shiftKey !== fine) {
        base = live.current.pos;
        x0 = ev.clientX;
        fine = ev.shiftKey;
      }
      const next = Math.max(0, Math.min(1, base + ((ev.clientX - x0) / width) * (fine ? FINE_FACTOR : 1)));
      onPos(next, true);
    };
    const end = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      delete el.dataset.drag;
      active.current = false;
      release();
      onReadout(null);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key;
    if (k === "ArrowRight" || k === "ArrowUp") onStep(1, e.shiftKey);
    else if (k === "ArrowLeft" || k === "ArrowDown") onStep(-1, e.shiftKey);
    else if (k === "Home") onHome();
    else if (k === "End") onEnd();
    else if (k === "Backspace" || k === "Delete") onReset();
    else return;
    // The arrange shortcuts (nudge clips, delete) must not also fire.
    e.preventDefault();
    e.stopPropagation();
  };

  const p = Math.max(0, Math.min(1, pos));
  const style = { "--p": p, "--from": bipolar ? Math.min(p, 0.5) : 0, "--to": bipolar ? Math.max(p, 0.5) : p } as CSSProperties;
  return (
    <div
      ref={rail}
      className={`hs${bipolar ? " bi" : ""} ${className}`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(p * 100)}
      aria-valuetext={valueText}
      data-tip={`${label}: ${valueText}`}
      style={style}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onReset();
      }}
      onKeyDown={onKeyDown}
      onFocus={() => onReadout(live.current.valueText)}
      onBlur={() => onReadout(null)}
    >
      <span className="hs-rail" aria-hidden="true" />
      <span className="hs-lit" aria-hidden="true" />
      <span className="hs-handle" aria-hidden="true" />
    </div>
  );
}
