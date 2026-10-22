import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function Panel({
  children,
  className = "",
  as: Tag = "section",
  label,
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "aside" | "div" | "footer" | "header";
  label?: string;
}) {
  return (
    <Tag className={`panel ${className}`} aria-label={label}>
      {children}
    </Tag>
  );
}

type ButtonVariant = "primary" | "ghost" | "danger" | "outline";

export function Button({
  children,
  onClick,
  variant = "ghost",
  disabled,
  title,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button type="button" className={`btn btn-${variant} ${className}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  onClick,
  active,
  size = 24,
  className = "",
}: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  active?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <button type="button" className={`icon-btn ${active ? "on" : ""} ${className}`} aria-label={label} title={label} onClick={onClick}>
      <Icon name={icon} size={size} />
    </button>
  );
}

export function Seg<T extends string | number>({
  options,
  value,
  onChange,
  label,
  className = "",
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={`seg ${className}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
  return (
    <label className="slider">
      <span className="slider-head">
        <span>{label}</span>
        <span className="mono">{format ? format(value) : String(Math.round(value * 100) / 100)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ "--pct": `${pct}%` } as CSSProperties}
      />
    </label>
  );
}

export function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="switch-row" onClick={() => onChange(!checked)}>
      <span>{label}</span>
      <span className={`switch ${checked ? "on" : ""}`}>
        <span className="knob" />
      </span>
    </button>
  );
}

export function Chip({ children, active, onClick }: { children: ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className={`chip ${active ? "on" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}

/** A big pressable pad; `onPress` fires on pointer down so live playing feels instant. */
export function Pad({
  name,
  keyLabel,
  color,
  selected,
  empty,
  onPress,
  onSelect,
}: {
  name: string;
  keyLabel?: string;
  color: string;
  selected?: boolean;
  empty?: boolean;
  onPress?: () => void;
  onSelect?: () => void;
}) {
  return (
    <button
      type="button"
      className={`pad ${selected ? "sel" : ""} ${empty ? "empty" : ""}`}
      style={{ "--c": color } as CSSProperties}
      onPointerDown={onPress}
      onClick={onSelect}
      aria-label={name}
    >
      {keyLabel && <span className="pad-key mono">{keyLabel}</span>}
      <span className="pad-name">{name}</span>
    </button>
  );
}

/** Macro knob drawn as a ring; drag vertically or use arrow keys. */
export function Ring({
  label,
  value,
  min = 0,
  max = 100,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  const pct = (value - min) / (max - min);
  const deg = pct * 270;
  const ring = `conic-gradient(from 225deg, var(--cyan) 0deg, var(--violet) ${deg * 0.6}deg, var(--pink) ${deg}deg, rgba(255,255,255,.12) ${deg}deg 270deg, transparent 270deg)`;
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div
      className="ring"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      onKeyDown={(e) => {
        const step = (max - min) / 50;
        if (e.key === "ArrowUp" || e.key === "ArrowRight") onChange(clamp(value + step));
        if (e.key === "ArrowDown" || e.key === "ArrowLeft") onChange(clamp(value - step));
      }}
      onPointerDown={(e) => {
        const startY = e.clientY;
        const startValue = value;
        const target = e.currentTarget;
        target.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) => onChange(clamp(startValue + ((startY - ev.clientY) / 150) * (max - min)));
        const up = () => {
          target.removeEventListener("pointermove", move);
          target.removeEventListener("pointerup", up);
        };
        target.addEventListener("pointermove", move);
        target.addEventListener("pointerup", up);
      }}
    >
      <div className="ring-dial" style={{ background: ring }}>
        <div className="ring-core mono">{Math.round(value)}</div>
      </div>
      <div className="ring-label">{label}</div>
    </div>
  );
}
