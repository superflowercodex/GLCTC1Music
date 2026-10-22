import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";

export interface WheelProps {
  label: string;
  /** Pitch wheels centre at zero and spring back; mod wheels stay where they are left. */
  spring: boolean;
  onChange: (value: number) => void;
  color: string;
}

const THUMB = 40;

export function Wheel({ label, spring, onChange, color }: WheelProps) {
  const track = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(0);
  const dragging = useRef(false);

  const min = spring ? -1 : 0;
  const apply = (next: number) => {
    const v = Math.max(min, Math.min(1, next));
    setValue(v);
    onChange(v);
  };
  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect) return;
    const usable = rect.height - THUMB;
    const frac = 1 - Math.max(0, Math.min(1, (e.clientY - rect.top - THUMB / 2) / usable));
    apply(spring ? frac * 2 - 1 : frac);
  };
  const end = () => {
    dragging.current = false;
    if (spring) apply(0);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = spring ? 0.25 : 0.1;
    if (e.key === "ArrowUp") apply(value + step);
    else if (e.key === "ArrowDown") apply(value - step);
    else if (e.key === "Home" && spring) apply(0);
    else return;
    e.preventDefault();
  };

  const frac = spring ? (value + 1) / 2 : value;
  return (
    <div className="go-wheel">
      <div
        ref={track}
        className="go-wheel-track"
        style={{ "--k": color } as CSSProperties}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-orientation="vertical"
        aria-valuemin={min}
        aria-valuemax={1}
        aria-valuenow={Math.round(value * 100) / 100}
        onKeyDown={onKeyDown}
        onKeyUp={() => spring && apply(0)}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e) => dragging.current && fromPointer(e)}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <div className={`go-wheel-thumb ${spring ? "spring" : ""}`} style={{ bottom: `calc(${frac} * (100% - ${THUMB}px))` }} />
      </div>
      <span className="sy-label">{label}</span>
    </div>
  );
}
