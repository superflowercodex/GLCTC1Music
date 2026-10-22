import { memo, type CSSProperties } from "react";
import { peekEngine } from "../../audio/engine";
import { EFFECT_DEFS } from "../../audio/effects";
import { formatDb } from "../../audio/mixMath";
import type { Track } from "../../project/model";
import { updateTrack } from "../../project/actions";
import { projectStore, uiStore } from "../../store/project";
import { DB_TICKS, Fader } from "../../ui/Fader";
import { Knob } from "../../ui/Knob";
import { LedMeter } from "../../ui/LedMeter";
import { padReadout } from "../../ui/kitMath";
import { MAX_INSERTS, setSend } from "./edit";

function edit(trackId: string, patch: Partial<Pick<Track, "gainDb" | "pan" | "muted" | "solo" | "cue">>): void {
  projectStore.set((p) => updateTrack(p, trackId, patch));
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const panText = (v: number): string => {
  const p = Math.round(Math.abs(v) * 100);
  return p === 0 ? "C" : `${v < 0 ? "L" : "R"}${p}`;
};
const dbText = (v: number): string => (v <= -60 ? "−∞" : formatDb(v));
/** "−59.9" is the widest gain readout. */
const DB_CHARS = 5;

export const Strip = memo(function Strip({ track, dimmed, selected, onOpenFx }: { track: Track; dimmed: boolean; selected: boolean; onOpenFx: (trackId: string) => void }) {
  // The bus reports RMS; the meter wants peak-like levels, so scale as the transport does.
  const getLevel = (): number => (peekEngine()?.peekBus(track.id)?.level() ?? 0) * Math.SQRT2;
  const insertSummary = track.inserts.length === 0 ? "No inserts" : track.inserts.map((i) => `${EFFECT_DEFS[i.type].label}${i.bypass ? " (off)" : ""}`).join(", ");
  return (
    <div className={`strip ${dimmed ? "dim" : ""} ${selected ? "sel" : ""}`} style={{ "--c": track.color, "--k": track.color } as CSSProperties}>
      <button type="button" className="strip-name" onClick={() => uiStore.set((s) => ({ ...s, selectedTrackId: track.id }))} data-tip={track.name} aria-pressed={selected}>
        <span className="strip-dot" />
        <span className="strip-label">{track.name}</span>
      </button>
      <button type="button" className="strip-fx" onClick={() => onOpenFx(track.id)} data-tip={insertSummary} aria-label={`${track.name} inserts: ${insertSummary}`}>
        <span className="caption-t">FX</span>
        <span className="pips" aria-hidden="true">
          {Array.from({ length: MAX_INSERTS }, (_, i) => {
            const ins = track.inserts[i];
            return <i key={i} className={ins ? (ins.bypass ? "byp" : "on") : ""} />;
          })}
        </span>
      </button>
      <div className="strip-knobs">
        <Knob label="Pan" ariaLabel={`${track.name} pan`} layout="row" size="sm" value={track.pan} min={-1} max={1} step={0.01} defaultValue={0} bipolar color={track.color} format={panText} onChange={(v) => edit(track.id, { pan: v })} />
        <Knob label="Rev" ariaLabel={`${track.name} reverb send`} layout="row" size="sm" value={track.sends.reverb} min={0} max={1} step={0.01} color={track.color} format={pct} onChange={(v) => projectStore.set((p) => setSend(p, track.id, "reverb", v))} />
        <Knob label="Dly" ariaLabel={`${track.name} delay send`} layout="row" size="sm" value={track.sends.delay} min={0} max={1} step={0.01} color={track.color} format={pct} onChange={(v) => projectStore.set((p) => setSend(p, track.id, "delay", v))} />
      </div>
      <div className="strip-ms btn-group" role="group" aria-label={`${track.name} monitoring`}>
        <button type="button" className={`mute ${track.muted ? "on" : ""}`} aria-pressed={track.muted} aria-label={`Mute ${track.name}`} onClick={() => edit(track.id, { muted: !track.muted })}>
          M
        </button>
        <button type="button" className={`solo ${track.solo ? "on" : ""}`} aria-pressed={track.solo} aria-label={`Solo ${track.name}`} onClick={() => edit(track.id, { solo: !track.solo })}>
          S
        </button>
        <button type="button" className={`cue ${track.cue ? "on" : ""}`} aria-pressed={track.cue} aria-label={`Cue ${track.name}`} data-tip="Listen in the headphones" onClick={() => edit(track.id, { cue: !track.cue })}>
          Cue
        </button>
      </div>
      <div className="strip-fader">
        <Fader label={`${track.name} volume`} hideLabel hideValue value={track.gainDb} min={-60} max={6} step={0.1} defaultValue={0} ticks={DB_TICKS} format={dbText} color={track.color} onChange={(db) => edit(track.id, { gainDb: db })} />
        <LedMeter getLevel={getLevel} label={`${track.name} level`} segmentPx={3} className="strip-vu" />
      </div>
      <span className="strip-db mono" aria-hidden="true">{padReadout(dbText(track.gainDb), DB_CHARS)}</span>
    </div>
  );
});
