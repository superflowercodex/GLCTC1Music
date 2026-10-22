import { useState, type CSSProperties } from "react";
import { EFFECT_DEFS, INSERT_TYPES } from "../../audio/effects";
import { hzToPosition, positionToHz } from "../../audio/mixMath";
import type { Insert, InsertType, Track } from "../../project/model";
import { projectStore } from "../../store/project";
import { useStore } from "../../store/store";
import type { ParamDef } from "../../audio/types";
import { Button, Seg, Slider, Switch } from "../../ui/controls";
import { addInsert, MAX_INSERTS, moveInsert, removeInsert, setInsertBypass, setInsertParam, setSend } from "./edit";

export function formatParam(def: ParamDef, value: number): string {
  if (def.options) return def.options[Math.round(value)] ?? String(value);
  switch (def.unit) {
    case "Hz":
      return value >= 1000 ? `${(value / 1000).toFixed(1)} kHz` : `${Math.round(value)} Hz`;
    case "ms":
      return `${Math.round(value)} ms`;
    case "dB":
      return `${value > 0 ? "+" : ""}${value.toFixed(1)} dB`;
    case "s":
      return `${value.toFixed(1)} s`;
    case ":1":
      return `${value.toFixed(1)}:1`;
    default:
      return def.max <= 1 ? `${Math.round(value * 100)}%` : value.toFixed(1);
  }
}

function ParamControl({ def, value, onChange }: { def: ParamDef; value: number; onChange: (value: number) => void }) {
  if (def.options) {
    return (
      <div className="param-seg">
        <span className="param-seg-label">{def.label}</span>
        <Seg label={def.label} options={def.options.map((label, i) => ({ value: i, label }))} value={Math.round(value)} onChange={onChange} />
      </div>
    );
  }
  if (def.unit === "Hz") {
    return (
      <Slider
        label={def.label}
        value={hzToPosition(value, def.min, def.max)}
        min={0}
        max={1}
        step={0.001}
        onChange={(p) => onChange(positionToHz(p, def.min, def.max))}
        format={() => formatParam(def, value)}
      />
    );
  }
  return <Slider label={def.label} value={value} min={def.min} max={def.max} step={def.step ?? 0.01} onChange={onChange} format={(v) => formatParam(def, v)} />;
}

function InsertEditor({ track, insert }: { track: Track; insert: Insert }) {
  const def = EFFECT_DEFS[insert.type];
  const index = track.inserts.findIndex((i) => i.id === insert.id);
  const apply = (fn: (p: ReturnType<typeof projectStore.get>) => ReturnType<typeof projectStore.get>): void => projectStore.set(fn);
  return (
    <div className="insert-editor">
      <div className="insert-editor-head">
        <h3>{def.label}</h3>
        <div className="insert-actions">
          <Button onClick={() => apply((p) => moveInsert(p, track.id, insert.id, -1))} disabled={index <= 0}>
            Move earlier
          </Button>
          <Button onClick={() => apply((p) => moveInsert(p, track.id, insert.id, 1))} disabled={index === track.inserts.length - 1}>
            Move later
          </Button>
          <Button variant="danger" onClick={() => apply((p) => removeInsert(p, track.id, insert.id))}>
            Remove
          </Button>
        </div>
      </div>
      <Switch label="Active" checked={!insert.bypass} onChange={(on) => apply((p) => setInsertBypass(p, track.id, insert.id, !on))} />
      <div className="param-grid">
        {def.params.map((p) => (
          <ParamControl key={p.id} def={p} value={insert.params[p.id] ?? p.def} onChange={(v) => apply((s) => setInsertParam(s, track.id, insert.id, p.id, v))} />
        ))}
      </div>
    </div>
  );
}

function Row({ track, selectedInsert, onSelect }: { track: Track; selectedInsert: string | null; onSelect: (id: string | null) => void }) {
  const [adding, setAdding] = useState(false);
  const editing = track.inserts.find((i) => i.id === selectedInsert);
  const full = track.inserts.length >= MAX_INSERTS;
  const add = (type: InsertType): void => {
    projectStore.set((p) => addInsert(p, track.id, type));
    setAdding(false);
  };
  return (
    <div className="fx-row" style={{ "--c": track.color } as CSSProperties}>
      <div className="fx-track">
        <span className="strip-dot" />
        <span className="fx-track-name">{track.name}</span>
      </div>
      <div className="fx-chain">
        {track.inserts.map((insert) => (
          <button
            key={insert.id}
            type="button"
            className={`fx-chip ${insert.id === selectedInsert ? "on" : ""} ${insert.bypass ? "off" : ""}`}
            aria-pressed={insert.id === selectedInsert}
            onClick={() => onSelect(insert.id === selectedInsert ? null : insert.id)}
          >
            {EFFECT_DEFS[insert.type].label}
            {insert.bypass && <small>off</small>}
          </button>
        ))}
        {!full && (
          <button type="button" className="fx-chip add" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
            + Add
          </button>
        )}
      </div>
      <div className="fx-sends">
        <Slider label="Reverb" value={track.sends.reverb} min={0} max={1} step={0.01} onChange={(v) => projectStore.set((p) => setSend(p, track.id, "reverb", v))} format={(v) => `${Math.round(v * 100)}%`} />
        <Slider label="Delay" value={track.sends.delay} min={0} max={1} step={0.01} onChange={(v) => projectStore.set((p) => setSend(p, track.id, "delay", v))} format={(v) => `${Math.round(v * 100)}%`} />
      </div>
      {adding && (
        <div className="fx-add" role="group" aria-label={`Add an effect to ${track.name}`}>
          {INSERT_TYPES.map((type) => (
            <button key={type} type="button" className="chip" onClick={() => add(type)}>
              {EFFECT_DEFS[type].label}
            </button>
          ))}
        </div>
      )}
      {editing && <InsertEditor track={track} insert={editing} />}
    </div>
  );
}

export function EffectsTab() {
  const tracks = useStore(projectStore, (p) => p.tracks);
  const [selected, setSelected] = useState<{ trackId: string; insertId: string } | null>(null);
  if (tracks.length === 0) {
    return <p className="mixer-empty">No tracks yet. Add one in Arrange or open an instrument, then come back to shape its sound.</p>;
  }
  return (
    <div className="fx-tab">
      <div className="fx-head">
        <span>Track</span>
        <span>Insert effects, in order</span>
        <span>Sends</span>
      </div>
      <div className="fx-list scroll-y">
        {tracks.map((t) => (
          <Row key={t.id} track={t} selectedInsert={selected?.trackId === t.id ? selected.insertId : null} onSelect={(insertId) => setSelected(insertId ? { trackId: t.id, insertId } : null)} />
        ))}
      </div>
      <p className="mixer-note">Inserts run top to bottom on the track. Sends feed the shared reverb and delay.</p>
    </div>
  );
}
