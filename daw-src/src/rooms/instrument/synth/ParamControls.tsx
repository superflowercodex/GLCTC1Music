import type { Instrument, ParamDef } from "../../../audio/types";
import { Caption } from "../../../ui/Caption";
import { Knob } from "../../../ui/Knob";
import { HwChoice } from "./HwChoice";
import { formatParam, fromPosition, toPosition, usesLogScale } from "./format";

const SEG_CHARS = 22;

function isOffOn(def: ParamDef): boolean {
  return def.options?.length === 2 && def.options[0] === "Off" && def.options[1] === "On";
}

export function ParamControl({ instrument, def, label }: { instrument: Instrument; def: ParamDef; label?: string }) {
  const value = instrument.getParam(def.id);
  const text = label ?? def.label;
  if (isOffOn(def))
    return (
      <button type="button" role="switch" aria-checked={value === 1} className="hw-key led wide" onClick={() => instrument.setParam(def.id, value === 1 ? 0 : 1)}>
        {text}
      </button>
    );
  if (def.options) {
    const options = def.options;
    const short = options.length <= 4 && options.join("").length <= SEG_CHARS;
    return (
      <div>
        <Caption as="div" className="sy-fieldhead">
          {text}
        </Caption>
        {short ? (
          <HwChoice label={text} value={Math.round(value)} onChange={(v) => instrument.setParam(def.id, v)} options={options.map((o, i) => ({ value: i, label: o }))} wrap={options.join("").length > 11} size={options.join("").length > 11 ? "sm" : undefined} />
        ) : (
          <select className="sy-select" aria-label={text} value={Math.round(value)} onChange={(e) => instrument.setParam(def.id, Number(e.target.value))}>
            {options.map((o, i) => (
              <option key={o} value={i}>
                {o}
              </option>
            ))}
          </select>
        )}
      </div>
    );
  }
  return <ParamSlider instrument={instrument} def={def} label={text} />;
}

/** A continuous parameter as a knob; frequency and time ranges turn on a log taper. Kept under its old name for callers. */
export function ParamSlider({ instrument, def, label }: { instrument: Instrument; def: ParamDef; label?: string }) {
  const value = instrument.getParam(def.id);
  const log = usesLogScale(def);
  const stepped = def.options !== undefined || (def.step !== undefined && def.step >= 1);
  return (
    <Knob
      label={label ?? def.label}
      value={log ? toPosition(def, value) : value}
      min={log ? 0 : def.min}
      max={log ? 1 : def.max}
      step={log ? undefined : def.options ? 1 : def.step}
      defaultValue={toPosition(def, def.def)}
      onChange={(v) => instrument.setParam(def.id, stepped ? Math.round(v) : fromPosition(def, v))}
      format={(v) => formatParam(def, log ? fromPosition(def, v) : v)}
    />
  );
}
