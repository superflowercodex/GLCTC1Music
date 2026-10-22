import { useEffect, useRef, useState, type CSSProperties } from "react";
import { EFFECT_DEFS, INSERT_TYPES } from "../../audio/effects";
import { hzToPosition, positionToHz } from "../../audio/mixMath";
import type { Insert, InsertType, Track } from "../../project/model";
import { projectStore } from "../../store/project";
import { useStore } from "../../store/store";
import type { ParamDef } from "../../audio/types";
import { Button, Seg } from "../../ui/controls";
import { Knob } from "../../ui/Knob";
import { useEdgeFade } from "../../ui/useEdgeFade";
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

function ParamControl({ def, value, color, onChange }: { def: ParamDef; value: number; color: string; onChange: (value: number) => void }) {
  if (def.options) {
    return (
      <div className="param-seg">
        <span className="caption-t">{def.label}</span>
        <Seg label={def.label} options={def.options.map((label, i) => ({ value: i, label }))} value={Math.round(value)} onChange={onChange} />
      </div>
    );
  }
  if (def.unit === "Hz") {
    return (
      <Knob
        label={def.label}
        value={hzToPosition(value, def.min, def.max)}
        min={0}
        max={1}
        step={0.001}
        defaultValue={hzToPosition(def.def, def.min, def.max)}
        color={color}
        onChange={(p) => onChange(positionToHz(p, def.min, def.max))}
        format={() => formatParam(def, value)}
      />
    );
  }
  return <Knob label={def.label} value={value} min={def.min} max={def.max} step={def.step ?? 0.01} defaultValue={def.def} color={color} onChange={onChange} format={(v) => formatParam(def, v)} />;
}

function InsertEditor({ track, insert }: { track: Track; insert: Insert }) {
  const def = EFFECT_DEFS[insert.type];
  const index = track.inserts.findIndex((i) => i.id === insert.id);
  const apply = (fn: (p: ReturnType<typeof projectStore.get>) => ReturnType<typeof projectStore.get>): void => projectStore.set(fn);
  return (
    <div className="insert-editor well">
      <div className="insert-editor-head">
        <h3>{def.label}</h3>
        <div className="insert-actions">
          <button type="button" className={`pill ${insert.bypass ? "" : "on"}`} aria-pressed={!insert.bypass} onClick={() => apply((p) => setInsertBypass(p, track.id, insert.id, !insert.bypass))}>
            {insert.bypass ? "Bypassed" : "Active"}
          </button>
          <Button size="sm" onClick={() => apply((p) => moveInsert(p, track.id, insert.id, -1))} disabled={index <= 0}>
            Move earlier
          </Button>
          <Button size="sm" onClick={() => apply((p) => moveInsert(p, track.id, insert.id, 1))} disabled={index === track.inserts.length - 1}>
            Move later
          </Button>
          <Button size="sm" variant="danger" onClick={() => apply((p) => removeInsert(p, track.id, insert.id))}>
            Remove
          </Button>
        </div>
      </div>
      <div className={`knob-grid ${insert.bypass ? "bypassed" : ""}`}>
        {def.params.map((p) => (
          <ParamControl key={p.id} def={p} value={insert.params[p.id] ?? p.def} color={track.color} onChange={(v) => apply((s) => setInsertParam(s, track.id, insert.id, p.id, v))} />
        ))}
      </div>
    </div>
  );
}

function Row({ track, selectedInsert, onSelect, focused }: { track: Track; selectedInsert: string | null; onSelect: (id: string | null) => void; focused: boolean }) {
  const [adding, setAdding] = useState(false);
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) el.current?.scrollIntoView?.({ block: "nearest" });
  }, [focused]);
  const editing = track.inserts.find((i) => i.id === selectedInsert);
  const full = track.inserts.length >= MAX_INSERTS;
  const add = (type: InsertType): void => {
    projectStore.set((p) => addInsert(p, track.id, type));
    setAdding(false);
  };
  return (
    <div ref={el} className={`fx-row ${focused ? "focus" : ""}`} style={{ "--c": track.color } as CSSProperties}>
      <div className="fx-track" data-tip={track.name}>
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
            data-tip={`${EFFECT_DEFS[insert.type].label}${insert.bypass ? " (bypassed)" : ""}`}
          >
            <span className="fx-chip-t">{EFFECT_DEFS[insert.type].label}</span>
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
        <Knob label="Rev" layout="row" ariaLabel={`${track.name} reverb send`} size="sm" color={track.color} value={track.sends.reverb} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => projectStore.set((p) => setSend(p, track.id, "reverb", v))} />
        <Knob label="Dly" layout="row" ariaLabel={`${track.name} delay send`} size="sm" color={track.color} value={track.sends.delay} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => projectStore.set((p) => setSend(p, track.id, "delay", v))} />
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

export function EffectsTab({ focusTrackId = null }: { focusTrackId?: string | null }) {
  const tracks = useStore(projectStore, (p) => p.tracks);
  const [selected, setSelected] = useState<{ trackId: string; insertId: string } | null>(null);
  const list = useRef<HTMLDivElement>(null);
  useEdgeFade(list, "y");
  if (tracks.length === 0) {
    return <p className="mixer-empty">No tracks yet. Add one in Arrange or open an instrument, then come back to shape its sound.</p>;
  }
  return (
    <div className="fx-tab">
      <div className="fx-head caption">
        <span className="caption-t">Track</span>
        <span className="caption-t">Inserts, in order</span>
        <span className="caption-t">Sends</span>
      </div>
      <div ref={list} className="fx-list scroll-y fade-y">
        {tracks.map((t) => (
          <Row key={t.id} track={t} focused={focusTrackId === t.id} selectedInsert={selected?.trackId === t.id ? selected.insertId : null} onSelect={(insertId) => setSelected(insertId ? { trackId: t.id, insertId } : null)} />
        ))}
      </div>
      <p className="mixer-note">Inserts run left to right on the track. Sends feed the shared reverb and delay.</p>
    </div>
  );
}
