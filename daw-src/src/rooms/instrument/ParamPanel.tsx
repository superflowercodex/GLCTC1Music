import { useRef, useState } from "react";
import type { Instrument, ParamDef } from "../../audio/types";
import { useInstrument } from "../../ui/hooks";
import { Seg } from "../../ui/controls";
import { Knob } from "../../ui/Knob";
import { Icon } from "../../ui/Icon";
import { useEdgeFade } from "../../ui/useEdgeFade";

function formatValue(def: ParamDef, value: number): string {
  if (def.options) return def.options[value] ?? String(value);
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 100) / 100;
  return `${rounded}${def.unit ? ` ${def.unit}` : ""}`;
}

function Control({ instrument, def }: { instrument: Instrument; def: ParamDef }) {
  const value = instrument.getParam(def.id);
  if (def.options) {
    return (
      <div>
        <div className="slider-head">
          <span>{def.label}</span>
        </div>
        <Seg
          size="sm"
          label={def.label}
          value={value}
          onChange={(v) => instrument.setParam(def.id, v)}
          options={def.options.map((label, i) => ({ value: i, label }))}
        />
      </div>
    );
  }
  return (
    <Knob
      label={def.label}
      value={value}
      min={def.min}
      max={def.max}
      step={def.step}
      defaultValue={def.def}
      onChange={(v) => instrument.setParam(def.id, v)}
      format={(v) => formatValue(def, v)}
    />
  );
}

/** One engraved section per parameter group; one is open at a time, so a 90-knob synth stays calm. */
export function ParamPanel({ instrument, only }: { instrument: Instrument; only?: readonly string[] }) {
  useInstrument(instrument);
  const groups = [...new Set(instrument.params.map((p) => p.group))].filter((g) => !only || only.includes(g));
  const [open, setOpen] = useState<string | null>(groups[0] ?? null);
  const list = useRef<HTMLDivElement>(null);
  useEdgeFade(list, "y");

  return (
    <>
      <div className="inst-head">
        <span className="engrave">Sound</span>
      </div>
      <div ref={list} className="param-list fade-y">
        {groups.map((group) => {
          const isOpen = open === group;
          return (
            <div className="group" key={group}>
              <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : group)}>
                <span className="grp-name">
                  <span className="grp-led" aria-hidden="true" />
                  {group}
                </span>
                <span style={{ transform: isOpen ? "rotate(-90deg)" : "rotate(90deg)", transition: "transform .2s", display: "grid" }}>
                  <Icon name="next" size={16} />
                </span>
              </button>
              {isOpen && (
                <div className="group-body knob-grid">
                  {instrument.params
                    .filter((p) => p.group === group)
                    .map((def) => (
                      <Control key={def.id} instrument={instrument} def={def} />
                    ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
