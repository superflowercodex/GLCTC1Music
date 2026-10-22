import { useEffect, useId, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent, useMemo } from "react";
import { arcOrigin, arcPath, assertRange, dragNorm, fromNorm, isNudgeKey, normToAngle, nudge, polar, SWEEP_END, SWEEP_START, toNorm, wheelValue, readoutChars, padReadout } from "./kitMath";

export type KnobSize = "sm" | "md" | "lg";

/** Dial diameters, mirrored by --knob-sm/md/lg in styles.css. */
export const KNOB_PX: Record<KnobSize, number> = { sm: 28, md: 36, lg: 48 };
// Fine ticks with every fifth one longer, printed on the glass between the dome and the ring.
const TICKS = 21;

export interface KnobProps {
  label: string;
  /** Screen-reader name when the visible label is short ("Pan" on a strip); defaults to `label`. */
  ariaLabel?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Double-click (or Backspace) returns here. Defaults to `min`, or 0 for bipolar ranges. */
  defaultValue?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  size?: KnobSize;
  /** Arc and glow colour; defaults to the room accent (--a1). */
  color?: string;
  /** Lights the arc outward from zero, for pan, detune and the like. */
  bipolar?: boolean;
  /** Hides the caption, for knobs that sit under their own heading. */
  hideLabel?: boolean;
  /** Hides the readout under the dial (the value is still announced and shown in the tooltip). */
  hideValue?: boolean;
  /** "stack" (default): label, dial, value centred in a column. "row": dial left, label over value right, for narrow strips. */
  layout?: "stack" | "row";
  disabled?: boolean;
  className?: string;
}

/** Rotary control: vertical drag (Shift = fine), wheel, arrow/Page/Home/End keys, double-click to reset. */
export function Knob({
  label,
  ariaLabel,
  value,
  min,
  max,
  step,
  defaultValue,
  onChange,
  format,
  size = "md",
  color,
  bipolar = min < 0 && max > 0,
  hideLabel,
  hideValue,
  layout = "stack",
  disabled,
  className = "",
}: KnobProps) {
  assertRange(min, max);
  const dial = useRef<HTMLDivElement>(null);
  const domeId = `kd${useId().replace(/:/g, "")}`;
  const live = useRef({ value, min, max, step, onChange, disabled });
  live.current = { value, min, max, step, onChange, disabled };
  const reset = defaultValue ?? (bipolar ? 0 : min);

  // React's onWheel is passive, so preventDefault (to keep the panel from scrolling) needs a native listener.
  useEffect(() => {
    const el = dial.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const s = live.current;
      if (s.disabled) return;
      e.preventDefault();
      const next = wheelValue(s.value, e.deltaY, s.min, s.max, s.step, e.shiftKey);
      if (next !== s.value) s.onChange(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const norm = toNorm(value, min, max);
  const angle = normToAngle(norm);
  const px = KNOB_PX[size];
  const c = 50;
  // The dial body is r≈39 in these units (the SVG overhangs it by 14% each side); the arc rides just outside it.
  const r = 44.5;
  const origin = arcOrigin(min, max, bipolar);
  const tip = polar(c, c, 26, angle);
  const base = polar(c, c, 13, angle);
  const text = format ? format(value) : String(Math.round(value * 100) / 100);
  // A fixed slot as wide as the widest readout, so the value never jitters or resizes while it changes.
  // Keyed on the formatter's source, since callers pass a fresh closure on every render.
  // Up to 8 characters fit the 80px knob pitch; longer readouts (named steps) stay centred and may ellipsize.
  const slot = useMemo(() => readoutChars(format ?? ((v) => String(Math.round(v * 100) / 100)), min, max, step, [reset]), [min, max, step, reset, format?.toString()]);
  const padded = layout !== "row" && slot <= 8;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    const target = e.currentTarget;
    target.focus();
    target.setPointerCapture(e.pointerId);
    target.dataset.drag = "";
    let startY = e.clientY;
    let startNorm = norm;
    let fine = e.shiftKey;
    const move = (ev: globalThis.PointerEvent) => {
      // Re-anchor when Shift changes mid-drag so the knob never jumps.
      if (ev.shiftKey !== fine) {
        startNorm = toNorm(live.current.value, min, max);
        startY = ev.clientY;
        fine = ev.shiftKey;
      }
      const next = fromNorm(dragNorm(startNorm, startY - ev.clientY, fine), min, max, step);
      if (next !== live.current.value) live.current.onChange(next);
    };
    const up = () => {
      delete target.dataset.drag;
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      if (reset !== value) onChange(reset);
      return;
    }
    if (!isNudgeKey(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const next = nudge(value, e.key, min, max, step, e.shiftKey);
    if (next !== value) onChange(next);
  };

  return (
    <div className={`knob-ctl knob-${size} ${layout === "row" ? "knob-row" : ""} ${disabled ? "is-disabled" : ""} ${className}`} style={{ "--k": color, "--kpx": `${px}px` } as CSSProperties}>
      {!hideLabel && (
        <span className="knob-label">
          <span>{label}</span>
        </span>
      )}
      <div
        ref={dial}
        className="knob-dial"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel ?? label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={text}
        aria-disabled={disabled || undefined}
        data-tip={`${ariaLabel ?? label}: ${text}. Drag or scroll; double-click resets.`}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onDoubleClick={() => !disabled && reset !== value && onChange(reset)}
      >
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <defs>
            <radialGradient id={domeId} cx=".36" cy=".3" r=".85">
              <stop offset="0" stopColor="#fff" stopOpacity=".4" />
              <stop offset=".55" stopColor="#fff" stopOpacity=".06" />
              <stop offset="1" stopColor="#fff" stopOpacity=".02" />
            </radialGradient>
          </defs>
          {Array.from({ length: TICKS }, (_, i) => {
            const a = SWEEP_START + (i / (TICKS - 1)) * (SWEEP_END - SWEEP_START);
            const major = i % 5 === 0;
            const p0 = polar(c, c, 39.5, a);
            const p1 = polar(c, c, major ? 34.5 : 36.5, a);
            const lit = bipolar ? (a >= Math.min(origin, angle) && a <= Math.max(origin, angle)) : a <= angle + 0.01;
            return <line key={i} className={`knob-tick${major ? " major" : ""}${lit ? " on" : ""}`} x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} />;
          })}
          <path className="knob-track" d={arcPath(c, c, r, SWEEP_START, SWEEP_END)} />
          {/* The ring is light: a soft bloom and a tight halo under a bright core, all in --k. */}
          <path className="knob-arc-bloom" d={arcPath(c, c, r, origin, angle)} />
          <path className="knob-arc-halo" d={arcPath(c, c, r, origin, angle)} />
          <path className="knob-arc" d={arcPath(c, c, r, origin, angle)} />
          {/* A glass dome floating over the pane: a clear body with a luminous rim (casting a soft shadow) and a specular. */}
          <circle className="knob-cap" cx={c} cy={c} r={30} />
          <circle className="knob-dome" cx={c} cy={c} r={30} fill={`url(#${domeId})`} />
          <line className="knob-ptr" x1={base.x} y1={base.y} x2={tip.x} y2={tip.y} />
        </svg>
      </div>
      {!hideValue && (
        <span className={`knob-value${padded ? " padded" : ""}`} style={{ "--slot": slot } as CSSProperties}>
          {padded ? padReadout(text, slot) : text}
        </span>
      )}
    </div>
  );
}
