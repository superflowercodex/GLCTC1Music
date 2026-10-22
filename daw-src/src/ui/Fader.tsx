import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent, useMemo } from "react";
import { assertRange, clamp, fromNorm, isNudgeKey, nudge, toNorm, wheelValue, readoutChars, padReadout } from "./kitMath";

export interface FaderTick {
  value: number;
  label?: string;
}

export interface FaderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  /** Scale marks beside the track, in the fader's own units (e.g. dB). */
  ticks?: readonly FaderTick[];
  color?: string;
  hideLabel?: boolean;
  hideValue?: boolean;
  disabled?: boolean;
  className?: string;
}

/** dB marks for a gain fader running -60..+6 dB. */
export const DB_TICKS: readonly FaderTick[] = [
  { value: 6, label: "+6" },
  { value: 0, label: "0" },
  { value: -6, label: "6" },
  { value: -12, label: "12" },
  { value: -24, label: "24" },
  { value: -40, label: "40" },
  { value: -60, label: "∞" },
];

/**
 * Vertical fader. It fills whatever height its parent gives it (set height on the wrapper), so a
 * mixer strip can stretch it. Clicking the track jumps; dragging the cap moves relative to the grab point.
 */
export function Fader({ label, value, min, max, step, defaultValue, onChange, format, ticks, color, hideLabel, hideValue, disabled, className = "" }: FaderProps) {
  assertRange(min, max);
  const track = useRef<HTMLDivElement>(null);
  const live = useRef({ value, onChange, disabled });
  live.current = { value, onChange, disabled };
  const reset = defaultValue ?? (min < 0 && max > 0 ? 0 : min);
  const norm = toNorm(value, min, max);
  const text = format ? format(value) : String(Math.round(value * 10) / 10);
  // A fixed slot as wide as the widest readout, so the value never jitters or resizes while it changes.
  // Keyed on the formatter's source, since callers pass a fresh closure on every render.
  const slot = useMemo(() => readoutChars(format ?? ((v) => String(Math.round(v * 10) / 10)), min, max, step, [reset]), [min, max, step, reset, format?.toString()]);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (live.current.disabled) return;
      e.preventDefault();
      const next = wheelValue(live.current.value, e.deltaY, min, max, step, e.shiftKey);
      if (next !== live.current.value) live.current.onChange(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [min, max, step]);

  const normAt = (clientY: number): number => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return norm;
    return clamp(1 - (clientY - rect.top) / rect.height, 0, 1);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    const target = e.currentTarget;
    target.focus();
    target.setPointerCapture(e.pointerId);
    target.dataset.drag = "";
    const onCap = (e.target as HTMLElement).closest(".fader-cap") !== null;
    // Grabbing the cap keeps its offset so it does not jump under the finger.
    const offset = onCap ? normAt(e.clientY) - norm : 0;
    if (!onCap) {
      const next = fromNorm(normAt(e.clientY), min, max, step);
      if (next !== value) onChange(next);
    }
    const move = (ev: globalThis.PointerEvent) => {
      const next = fromNorm(normAt(ev.clientY) - offset, min, max, step);
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
    if (disabled || !isNudgeKey(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const next = nudge(value, e.key, min, max, step, e.shiftKey);
    if (next !== value) onChange(next);
  };

  return (
    <div className={`fader ${disabled ? "is-disabled" : ""} ${className}`} style={{ "--k": color, "--fn": norm } as CSSProperties}>
      {!hideLabel && <span className="fader-label">{label}</span>}
      <div className="fader-body">
        {ticks && (
          <div className="fader-ticks" aria-hidden="true">
            {ticks.map((t) => (
              <span key={t.value} style={{ bottom: `${toNorm(t.value, min, max) * 100}%` }}>
                {t.label}
              </span>
            ))}
          </div>
        )}
        <div
          ref={track}
          className="fader-track"
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={label}
          aria-orientation="vertical"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={text}
          aria-disabled={disabled || undefined}
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
          onDoubleClick={() => !disabled && reset !== value && onChange(reset)}
        >
          <div className="fader-groove" />
          <div className="fader-glow" />
          <div className="fader-fill" />
          <div className="fader-cap" />
        </div>
      </div>
      {!hideValue && <span className="fader-value" style={{ "--slot": slot } as CSSProperties}>{padReadout(text, slot)}</span>}
    </div>
  );
}
