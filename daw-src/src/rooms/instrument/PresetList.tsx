import { useState } from "react";
import type { Instrument } from "../../audio/types";
import { Button, Chip } from "../../ui/controls";
import { useInstrument } from "../../ui/hooks";

export function PresetList({ instrument }: { instrument: Instrument }) {
  useInstrument(instrument);
  const presets = instrument.presets;
  const categories = ["All", ...new Set(presets.map((p) => p.category))];
  const [category, setCategory] = useState("All");
  const shown = category === "All" ? presets : presets.filter((p) => p.category === category);
  const current = instrument.serialize().presetId;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h2>Presets</h2>
        <span className="eyebrow">{presets.filter((p) => p.factory).length} factory</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {categories.map((c) => (
          <Chip key={c} active={c === category} onClick={() => setCategory(c)}>
            {c}
          </Chip>
        ))}
      </div>
      <div className="scroll-y" style={{ display: "grid", gap: 6, alignContent: "start", flex: 1 }}>
        {shown.map((p) => (
          <div key={p.id} style={{ display: "flex", gap: 6 }}>
            <button type="button" className={`preset-row ${p.id === current ? "on" : ""}`} style={{ flex: 1 }} onClick={() => instrument.loadPreset(p.id)}>
              <span>{p.name}</span>
              <small>{p.category}</small>
            </button>
            {!p.factory && (
              <Button variant="danger" onClick={() => instrument.deleteUserPreset(p.id)} title={`Delete ${p.name}`}>
                Delete
              </Button>
            )}
          </div>
        ))}
        {shown.length === 0 && <p className="eyebrow">No presets here yet.</p>}
      </div>
    </>
  );
}
