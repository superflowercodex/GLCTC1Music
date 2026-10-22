import type { Instrument, ParamDef } from "../../../audio/types";
import { Seg, Slider } from "../../../ui/controls";

export function formatParam(def: ParamDef, value: number): string {
  if (def.options) return def.options[value] ?? String(value);
  if (def.unit === "Hz") return value >= 1000 ? `${(value / 1000).toFixed(1)} kHz` : `${Math.round(value)} Hz`;
  if (def.unit) return `${Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 100) / 100} ${def.unit}`;
  if (def.min < 0 && def.max === 1) return value === 0 ? "C" : value < 0 ? `L ${Math.round(-value * 100)}` : `R ${Math.round(value * 100)}`;
  return `${Math.round(value * 100)}%`;
}

/** One slider or segmented control for a parameter, in the same style as the shell's automatic panel. */
export function ParamControl({ instrument, id }: { instrument: Instrument; id: string }) {
  const def = instrument.params.find((p) => p.id === id);
  if (!def) throw new RangeError(`${instrument.kind} has no parameter "${id}"`);
  const value = instrument.getParam(id);
  if (def.options && def.options.length > 6) {
    return (
      <label className="slider">
        <span className="slider-head">
          <span>{def.label}</span>
        </span>
        <select className="drum-select" value={value} onChange={(e) => instrument.setParam(id, Number(e.target.value))}>
          {def.options.map((label, i) => (
            <option key={label} value={i}>
              {label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (def.options) {
    return (
      <div>
        <div className="slider-head">
          <span>{def.label}</span>
        </div>
        <Seg label={def.label} value={value} onChange={(v) => instrument.setParam(id, v)} options={def.options.map((label, i) => ({ value: i, label }))} />
      </div>
    );
  }
  return (
    <Slider
      label={def.label}
      value={value}
      min={def.min}
      max={def.max}
      step={def.step ?? (def.max - def.min) / 200}
      onChange={(v) => instrument.setParam(id, v)}
      format={(v) => formatParam(def, v)}
    />
  );
}

/** Mute and solo as two small toggles, so they do not each take a full-width row. */
export function MuteSolo({ instrument, voice }: { instrument: Instrument; voice: number }) {
  const mute = instrument.getParam(`v${voice}.mute`) === 1;
  const solo = instrument.getParam(`v${voice}.solo`) === 1;
  return (
    <div className="vp-chips">
      <button type="button" className={`chip ${mute ? "on" : ""}`} aria-pressed={mute} onClick={() => instrument.setParam(`v${voice}.mute`, mute ? 0 : 1)}>
        Mute
      </button>
      <button type="button" className={`chip ${solo ? "on" : ""}`} aria-pressed={solo} onClick={() => instrument.setParam(`v${voice}.solo`, solo ? 0 : 1)}>
        Solo
      </button>
    </div>
  );
}
