import type { Instrument, ParamDef } from "../../../audio/types";
import { Seg, Slider, Switch } from "../../../ui/controls";
import { formatParam, fromPosition, toPosition, usesLogScale } from "./format";

const SEG_CHARS = 22;

function isOffOn(def: ParamDef): boolean {
  return def.options?.length === 2 && def.options[0] === "Off" && def.options[1] === "On";
}

export function ParamControl({ instrument, def, label }: { instrument: Instrument; def: ParamDef; label?: string }) {
  const value = instrument.getParam(def.id);
  const text = label ?? def.label;
  if (isOffOn(def)) return <Switch label={text} checked={value === 1} onChange={(on) => instrument.setParam(def.id, on ? 1 : 0)} />;
  if (def.options) {
    const options = def.options;
    const short = options.length <= 4 && options.join("").length <= SEG_CHARS;
    return (
      <div>
        <div className="slider-head">
          <span>{text}</span>
        </div>
        {short ? (
          <Seg label={text} value={Math.round(value)} onChange={(v) => instrument.setParam(def.id, v)} options={options.map((o, i) => ({ value: i, label: o }))} />
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

export function ParamSlider({ instrument, def, label }: { instrument: Instrument; def: ParamDef; label?: string }) {
  const value = instrument.getParam(def.id);
  const log = usesLogScale(def);
  const stepped = def.options !== undefined || (def.step !== undefined && def.step >= 1);
  return (
    <Slider
      label={label ?? def.label}
      value={log ? toPosition(def, value) : value}
      min={log ? 0 : def.min}
      max={log ? 1 : def.max}
      step={log ? 0.001 : def.options ? 1 : (def.step ?? (def.max - def.min) / 200)}
      onChange={(v) => instrument.setParam(def.id, stepped ? Math.round(v) : fromPosition(def, v))}
      format={(v) => formatParam(def, log ? fromPosition(def, v) : v)}
    />
  );
}
