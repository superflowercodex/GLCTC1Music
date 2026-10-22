import type { Instrument, ParamDef } from "../../../audio/types";
import { Caption } from "../../../ui/Caption";
import { Knob } from "../../../ui/Knob";
import { HwChoice } from "../synth/HwChoice";

function format(def: ParamDef, value: number): string {
  if (def.options) return def.options[value] ?? String(value);
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 100) / 100;
  if (def.unit === "s" || def.unit === "ms" || def.unit === "Hz" || def.unit === "dB" || def.unit === "st" || def.unit === "cents" || def.unit === "bars" || def.unit === ": 1") {
    return `${rounded > 0 && (def.unit === "st" || def.unit === "dB") ? "+" : ""}${rounded} ${def.unit}`;
  }
  return def.min === 0 && def.max <= 2 && !def.unit ? `${Math.round(value * 100)}%` : String(rounded);
}

/** One parameter as a knob, or a row of lit keys when it has named options. */
export function ParamControl({ instrument, id, label }: { instrument: Instrument; id: string; label?: string }) {
  const def = instrument.params.find((p) => p.id === id);
  if (!def) throw new RangeError(`${instrument.kind} has no parameter "${id}"`);
  const value = instrument.getParam(id);
  const name = label ?? def.label;
  if (def.options) {
    const wrap = def.options.length > 3 || def.options.join("").length > 11;
    return (
      <div>
        <Caption as="div" className="sy-fieldhead">
          {name}
        </Caption>
        <HwChoice label={name} value={value} onChange={(v) => instrument.setParam(id, v)} options={def.options.map((o, i) => ({ value: i, label: o }))} wrap={wrap} size={wrap ? "sm" : undefined} />
      </div>
    );
  }
  return (
    <Knob
      label={name}
      value={value}
      min={def.min}
      max={def.max}
      step={def.step}
      defaultValue={def.def}
      onChange={(v) => instrument.setParam(id, v)}
      format={(v) => format(def, v)}
    />
  );
}
