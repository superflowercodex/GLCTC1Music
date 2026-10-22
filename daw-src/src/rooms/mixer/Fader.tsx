import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { dbToFader, FADER_MAX_DB, FADER_MIN_DB, faderToDb, formatDb } from "../../audio/mixMath";

const THUMB = 40;

/** Vertical fader in decibels. Drag, arrow keys (1 dB, Shift for 6), Home/End, or double-click for 0 dB. */
export function Fader({
  db,
  onChange,
  label,
  color = "var(--cyan)",
  glow = "rgba(142, 124, 255, .7)",
}: {
  db: number;
  onChange: (db: number) => void;
  label: string;
  color?: string;
  glow?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const position = dbToFader(db);

  const fromPointer = (e: PointerEvent<HTMLDivElement>): void => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.height <= THUMB) return;
    const usable = rect.height - THUMB;
    const p = 1 - (e.clientY - rect.top - THUMB / 2) / usable;
    onChange(faderToDb(p));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = e.shiftKey ? 6 : 1;
    let next: number | undefined;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") next = db + step;
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") next = db - step;
    else if (e.key === "PageUp") next = db + 6;
    else if (e.key === "PageDown") next = db - 6;
    else if (e.key === "Home") next = FADER_MAX_DB;
    else if (e.key === "End") next = FADER_MIN_DB;
    else if (e.key === "0") next = 0;
    if (next === undefined) return;
    e.preventDefault();
    onChange(Math.min(FADER_MAX_DB, Math.max(FADER_MIN_DB, next)));
  };

  const style = { "--pos": position, "--c": color, "--glow": glow, "--thumb": `${THUMB}px` } as CSSProperties;
  return (
    <div
      ref={track}
      className="fader"
      style={style}
      role="slider"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={FADER_MIN_DB}
      aria-valuemax={FADER_MAX_DB}
      aria-valuenow={Math.round(db * 10) / 10}
      aria-valuetext={`${formatDb(db)} dB`}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onChange(0)}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        fromPointer(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) fromPointer(e);
      }}
    >
      <div className="fader-rail" />
      <div className="fader-fill" />
      <div className="fader-thumb">
        <span />
      </div>
    </div>
  );
}
