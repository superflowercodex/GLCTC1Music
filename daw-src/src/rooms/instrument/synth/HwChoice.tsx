export interface HwOption<T extends string | number> {
  value: T;
  label: string;
}

/** A row of backlit keys where one is lit: the hardware counterpart of a segmented control. */
export function HwChoice<T extends string | number>({
  options,
  value,
  onChange,
  label,
  size,
  wrap,
  className = "",
}: {
  options: ReadonlyArray<HwOption<T>>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: "sm";
  /** Many or long options: keys keep their natural width and wrap. */
  wrap?: boolean;
  className?: string;
}) {
  return (
    <div className={`hw-keys tight hw-choice ${wrap ? "wrap" : ""} ${className}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} className={`hw-key wide ${size ?? ""}`} onClick={() => onChange(o.value)}>
          <span className="hw-key-t">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
