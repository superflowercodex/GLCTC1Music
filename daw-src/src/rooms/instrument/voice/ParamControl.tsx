import type { Instrument, ParamDef } from "../../../audio/types";
import { Chip, Seg, Slider } from "../../../ui/controls";

function format(def: ParamDef, value: number): string {
  if (def.options) return def.options[value] ?? String(value);
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 100) / 100;
  if (def.unit === "s" || def.unit === "ms" || def.unit === "Hz" || def.unit === "dB" || def.unit === "st" || def.unit === "cents" || def.unit === "bars" || def.unit === ": 1") {
    return `${rounded > 0 && (def.unit === "st" || def.unit === "dB") ? "+" : ""}${rounded} ${def.unit}`;
  }
  return def.min === 0 && def.max <= 2 && !def.unit ? `${Math.round(value * 100)}%` : String(rounded);
}

/** One parameter as a slider, or a segmented control when it has named options. */
export function ParamControl({ instrument, id, label }: { instrument: Instrument; id: string; label?: string }) {
  const def = instrument.params.find((p) => p.id === id);
  if (!def) throw new RangeError(`${instrument.kind} has no parameter "${id}"`);
  const value = instrument.getParam(id);
  const name = label ?? def.label;
  if (def.options) {
    const options = def.options;
    return (
      <div>
        <div className="slider-head">
          <span>{name}</span>
        </div>
        {options.length > 3 ? (
          <div role="radiogroup" aria-label={name} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {options.map((o, i) => (
              <Chip key={o} active={i === value} onClick={() => instrument.setParam(id, i)}>
                {o}
              </Chip>
            ))}
          </div>
        ) : (
          <Seg label={name} value={value} onChange={(v) => instrument.setParam(id, v)} options={options.map((o, i) => ({ value: i, label: o }))} />
        )}
      </div>
    );
  }
  return (
    <Slider
      label={name}
      value={value}
      min={def.min}
      max={def.max}
      step={def.step ?? (def.max - def.min) / 200}
      onChange={(v) => instrument.setParam(id, v)}
      format={(v) => format(def, v)}
    />
  );
}
