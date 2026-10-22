import type { CSSProperties } from "react";

/** A small horizontal fader: recessed rail, light along it up to a ribbed cap. A native range input, so keys and wheel work. */
export function HwSlider({
  label,
  value,
  min,
  max,
  step,
  text,
  color,
  onChange,
  className = "",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  text: string;
  color?: string;
  onChange: (value: number) => void;
  className?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      className={`hw-slider ${className}`}
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      aria-valuetext={text}
      style={{ "--pct": `${pct}%`, ...(color ? { "--lit": color } : {}) } as CSSProperties}
      onChange={(e) => onChange(Number(e.target.value))}
      onDoubleClick={undefined}
    />
  );
}
