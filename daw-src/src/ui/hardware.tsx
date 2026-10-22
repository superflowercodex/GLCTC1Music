import { useRef, useState, type CSSProperties, type ReactNode, type PointerEvent } from "react";

/**
 * An area on the room's glass sheet (presets, play surface, sound, channels, master). It draws no box: the sheet
 * behind the room is the only glass, and neighbouring areas are told apart by a faint seam of light.
 */
export function Faceplate({
  children,
  as: Tag = "section",
  label,
  color,
  className = "",
  style,
}: {
  children: ReactNode;
  as?: "section" | "aside" | "div";
  label?: string;
  /** Accent for any kit control inside (sets --k). */
  color?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <Tag className={`panel faceplate fp ${className}`} aria-label={label} style={{ ...style, "--k": color } as CSSProperties}>
      {children}
    </Tag>
  );
}

/**
 * Raised glass performance pad that lights in --c. `onPress` fires on pointer down so playing feels instant;
 * `lit` fills it with its colour (a loaded or playing pad), `selected` lights its outline.
 */
export function PadButton({
  label,
  sub,
  color,
  lit,
  selected,
  disabled,
  onPress,
  onRelease,
  onClick,
  ariaLabel,
  className = "",
  style,
}: {
  label?: ReactNode;
  /** Tiny printed legend in the top-left corner (key, number). */
  sub?: ReactNode;
  color?: string;
  lit?: boolean;
  selected?: boolean;
  disabled?: boolean;
  onPress?: (velocity: number) => void;
  onRelease?: () => void;
  onClick?: () => void;
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const [down, setDown] = useState(false);
  const release = () => {
    if (!down) return;
    setDown(false);
    onRelease?.();
  };
  return (
    <button
      type="button"
      className={`hw-pad ${lit ? "lit" : ""} ${selected ? "sel" : ""} ${down ? "down" : ""} ${className}`}
      style={{ ...style, "--c": color } as CSSProperties}
      disabled={disabled}
      aria-label={ariaLabel ?? (typeof label === "string" ? label : undefined)}
      aria-pressed={selected}
      onPointerDown={(e: PointerEvent<HTMLButtonElement>) => {
        if (e.button !== 0) return;
        setDown(true);
        // Strikes nearer the top of the pad play softer, as on a velocity pad hit off-centre.
        const r = e.currentTarget.getBoundingClientRect();
        const v = r.height > 0 ? 0.55 + 0.45 * Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) : 1;
        onPress?.(v);
      }}
      onPointerUp={release}
      onPointerLeave={release}
      onPointerCancel={release}
      onClick={onClick}
    >
      {sub !== undefined && <span className="hw-pad-sub">{sub}</span>}
      {label !== undefined && <span className="hw-pad-label">{label}</span>}
    </button>
  );
}

/**
 * Glass step cell with a light bar above it. `on` fills the cell with --c and lights the bar; `current` is the
 * travelling playhead (a white bar and rim); `accent` brightens a lit step (accented note).
 */
export function StepButton({
  on,
  current,
  accent,
  color,
  label,
  ariaLabel,
  onToggle,
  disabled,
  className = "",
}: {
  on: boolean;
  current?: boolean;
  accent?: boolean;
  color?: string;
  /** Printed legend under the key (step number). */
  label?: ReactNode;
  ariaLabel: string;
  onToggle: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`hw-step ${on ? "on" : ""} ${current ? "now" : ""} ${accent ? "acc" : ""} ${className}`}
      style={{ "--c": color } as CSSProperties}
      aria-pressed={on}
      aria-label={ariaLabel}
      disabled={disabled}
      onPointerDown={(e) => {
        if (e.button === 0) onToggle();
      }}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <span className="hw-step-led" aria-hidden="true" />
      <span className="hw-step-key" aria-hidden="true" />
      {label !== undefined && <span className="hw-step-label">{label}</span>}
    </button>
  );
}

const BLACK = new Set([1, 3, 6, 8, 10]);
const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
// Real keyboards offset black keys inside each group (C♯/D♯ lean out, F♯/A♯ spread), measured from a white-key width.
const BLACK_OFFSET: Record<number, number> = { 1: -0.12, 3: 0.12, 6: -0.15, 8: 0, 10: 0.15 };

export function noteName(midi: number): string {
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/** White and black keys between low and high (inclusive), with each black key's centre in white-key units. */
export function keybedLayout(low: number, high: number): { whites: number[]; blacks: { note: number; x: number }[] } {
  const whites: number[] = [];
  const blacks: { note: number; x: number }[] = [];
  for (let n = low; n <= high; n++) {
    const pc = ((n % 12) + 12) % 12;
    if (BLACK.has(pc)) {
      // A black key needs a white on both sides, so one at either end of the range is left out.
      if (whites.length > 0 && n < high) blacks.push({ note: n, x: whites.length + BLACK_OFFSET[pc] });
    } else whites.push(n);
  }
  return { whites, blacks };
}

/**
 * Glass keybed in real proportions (black keys 58% wide, 62% long): frosted whites, dark-glass blacks,
 * pressed keys light in --k.
 * Pointer: press, glide across keys while held, release. Notes in `active` (e.g. from MIDI) also light.
 */
export function Keybed({
  low = 48,
  high = 72,
  active,
  color,
  onNoteOn,
  onNoteOff,
  showLabels = true,
  className = "",
  ariaLabel = "Keyboard",
}: {
  low?: number;
  high?: number;
  active?: ReadonlySet<number> | readonly number[];
  color?: string;
  onNoteOn?: (note: number, velocity: number) => void;
  onNoteOff?: (note: number) => void;
  /** Prints the C of each octave on its key. */
  showLabels?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const { whites, blacks } = keybedLayout(low, high);
  const [held, setHeld] = useState<ReadonlySet<number>>(new Set());
  const pointers = useRef(new Map<number, number>());
  const lit = new Set<number>([...held, ...(active ? [...active] : [])]);
  const W = whites.length;

  const press = (pointer: number, note: number | null) => {
    const prev = pointers.current.get(pointer);
    if (prev === note) return;
    if (prev !== undefined) onNoteOff?.(prev);
    if (note === null) pointers.current.delete(pointer);
    else {
      pointers.current.set(pointer, note);
      onNoteOn?.(note, 0.85);
    }
    setHeld(new Set(pointers.current.values()));
  };
  const noteAt = (e: PointerEvent<HTMLDivElement>): number | null => {
    const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-note]");
    return el && e.currentTarget.contains(el) ? Number(el.dataset.note) : null;
  };

  return (
    <div
      className={`keybed ${className}`}
      style={{ "--k": color, "--wk": W } as CSSProperties}
      role="group"
      aria-label={ariaLabel}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        press(e.pointerId, noteAt(e));
      }}
      onPointerMove={(e) => {
        if (pointers.current.has(e.pointerId)) press(e.pointerId, noteAt(e));
      }}
      onPointerUp={(e) => press(e.pointerId, null)}
      onPointerCancel={(e) => press(e.pointerId, null)}
    >
      {whites.map((n) => (
        <span key={n} className={`kb-w ${lit.has(n) ? "on" : ""}`} data-note={n} aria-label={noteName(n)}>
          {showLabels && n % 12 === 0 && <span className="kb-legend">{noteName(n)}</span>}
        </span>
      ))}
      {blacks.map(({ note, x }) => (
        <span key={note} className={`kb-b ${lit.has(note) ? "on" : ""}`} data-note={note} aria-label={noteName(note)} style={{ left: `${(x / W) * 100}%` }} />
      ))}
    </div>
  );
}

/**
 * Holographic readout (BPM, preset name, a value): a thin luminous outline with a DM Mono legend glowing in
 * --k. `label` prints a tiny tracked caption above the value.
 */
export function Display({
  value,
  label,
  unit,
  size = "md",
  color,
  dim,
  align = "center",
  className = "",
  style,
}: {
  value: ReactNode;
  label?: string;
  unit?: string;
  size?: "sm" | "md" | "lg";
  color?: string;
  /** Unlit legend (no signal / bypassed). */
  dim?: boolean;
  align?: "start" | "center" | "end";
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`hw-display hw-display-${size} ${dim ? "dim" : ""} ${className}`} style={{ ...style, "--k": color, textAlign: align === "center" ? "center" : align === "end" ? "right" : "left" } as CSSProperties}>
      {label && <span className="hw-display-label">{label}</span>}
      <span className="hw-display-value">
        {value}
        {unit && <small>{unit}</small>}
      </span>
    </div>
  );
}

/** Native select drawn as a glass field with a hairline outline and a chevron. */
export function SelectField<T extends string | number>({
  label,
  value,
  options,
  onChange,
  hideLabel,
  size = "md",
  className = "",
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  hideLabel?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <label className={`select-field select-${size} ${className}`}>
      {!hideLabel && <span className="select-label">{label}</span>}
      <span className="select-box">
        <select
          value={String(value)}
          aria-label={label}
          onChange={(e) => {
            const hit = options.find((o) => String(o.value) === e.target.value);
            if (hit) onChange(hit.value);
          }}
        >
          {options.map((o) => (
            <option key={String(o.value)} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}

/**
 * A layout group on the glass sheet: the window is the grid/flex container itself (pass the layout class as
 * `className`), so it adds no box and draws nothing of its own.
 */
export function GlassWindow({
  children,
  className = "",
  style,
  role,
  ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  role?: string;
  ariaLabel?: string;
}) {
  return (
    <div className={`glass-win ${className}`} style={style} role={role} aria-label={ariaLabel}>
      {children}
    </div>
  );
}
