import { memo, type CSSProperties } from "react";
import { peekEngine } from "../../audio/engine";
import { formatDb, formatPan } from "../../audio/mixMath";
import type { Track } from "../../project/model";
import { updateTrack } from "../../project/actions";
import { projectStore, uiStore } from "../../store/project";
import { Meter } from "../../ui/Meter";
import { Fader } from "./Fader";

function edit(trackId: string, patch: Partial<Pick<Track, "gainDb" | "pan" | "muted" | "solo">>): void {
  projectStore.set((p) => updateTrack(p, trackId, patch));
}

export const Strip = memo(function Strip({ track, dimmed, selected }: { track: Track; dimmed: boolean; selected: boolean }) {
  const getLevel = (): number => peekEngine()?.peekBus(track.id)?.level() ?? 0;
  const panPct = ((track.pan + 1) / 2) * 100;
  return (
    <div className={`strip ${dimmed ? "dim" : ""} ${selected ? "sel" : ""}`} style={{ "--c": track.color } as CSSProperties}>
      <button type="button" className="strip-name" onClick={() => uiStore.set((s) => ({ ...s, selectedTrackId: track.id }))} title={track.name} aria-pressed={selected}>
        <span className="strip-dot" />
        <span className="strip-label">{track.name}</span>
      </button>
      <div className="strip-body">
        <Meter getLevel={getLevel} />
        <Fader db={track.gainDb} onChange={(db) => edit(track.id, { gainDb: db })} label={`${track.name} volume`} color={track.color} glow={`${track.color}99`} />
      </div>
      <div className="strip-db mono">{formatDb(track.gainDb)}</div>
      <label className="pan" style={{ "--pct": `${panPct}%` } as CSSProperties}>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={track.pan}
          aria-label={`${track.name} pan`}
          aria-valuetext={formatPan(track.pan)}
          onChange={(e) => edit(track.id, { pan: Number(e.target.value) })}
          onDoubleClick={() => edit(track.id, { pan: 0 })}
        />
        <span className="pan-value mono">{formatPan(track.pan)}</span>
      </label>
      <div className="strip-ms">
        <button type="button" className={`ms mute ${track.muted ? "on" : ""}`} aria-pressed={track.muted} aria-label={`Mute ${track.name}`} onClick={() => edit(track.id, { muted: !track.muted })}>
          M
        </button>
        <button type="button" className={`ms solo ${track.solo ? "on" : ""}`} aria-pressed={track.solo} aria-label={`Solo ${track.name}`} onClick={() => edit(track.id, { solo: !track.solo })}>
          S
        </button>
      </div>
    </div>
  );
});
