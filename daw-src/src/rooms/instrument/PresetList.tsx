import { useRef, useState } from "react";
import type { Instrument } from "../../audio/types";
import { Chip } from "../../ui/controls";
import { useInstrument } from "../../ui/hooks";
import { Icon } from "../../ui/Icon";
import { GlassWindow } from "../../ui/hardware";
import { useEdgeFade } from "../../ui/useEdgeFade";

/** The preset browser: category chips over a backlit display list; the loaded preset lights with an LED. */
export function PresetList({ instrument }: { instrument: Instrument }) {
  useInstrument(instrument);
  const presets = instrument.presets;
  const categories = ["All", ...new Set(presets.map((p) => p.category))];
  const [category, setCategory] = useState("All");
  const shown = category === "All" ? presets : presets.filter((p) => p.category === category);
  const current = instrument.serialize().presetId;
  const list = useRef<HTMLDivElement>(null);
  useEdgeFade(list, "y");

  return (
    <>
      <div className="inst-head">
        <span className="engrave">Presets</span>
        <span className="engrave" style={{ color: "var(--ink-3)", letterSpacing: ".1em" }}>
          {presets.length}
        </span>
      </div>
      {categories.length > 2 && (
        <div className="preset-cats" role="group" aria-label="Preset category">
          {categories.map((c) => (
            <Chip key={c} size="sm" active={c === category} onClick={() => setCategory(c)}>
              {c}
            </Chip>
          ))}
        </div>
      )}
      <GlassWindow className="preset-screen">
        <div ref={list} className="preset-list fade-y" role="listbox" aria-label="Presets">
          {shown.map((p) => (
            <div key={p.id} className="preset-item">
              <button type="button" role="option" aria-selected={p.id === current} className={`preset-row ${p.id === current ? "on" : ""}`} onClick={() => instrument.loadPreset(p.id)}>
                <span>{p.name}</span>
                <small>{p.factory ? p.category : "User"}</small>
              </button>
              {!p.factory && (
                <button type="button" className="preset-del" aria-label={`Delete ${p.name}`} data-tip={`Delete ${p.name}`} onClick={() => instrument.deleteUserPreset(p.id)}>
                  <Icon name="trash" size={16} />
                </button>
              )}
            </div>
          ))}
          {shown.length === 0 && <p className="preset-empty">No presets here yet.</p>}
        </div>
      </GlassWindow>
    </>
  );
}
