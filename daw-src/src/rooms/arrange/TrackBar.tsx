import { useState, type CSSProperties } from "react";
import { TRACK_COLORS, updateTrack } from "../../project/actions";
import type { Track } from "../../project/model";
import { colorTracks, deleteTracks, selectTrackClips } from "./ops";
import { clearTrackSelection } from "./selection";
import { projectStore } from "../../store/project";

/** Appears under the timeline when several tracks are selected: the edits that apply to all of them at once. */
export function TrackBar({ tracks }: { tracks: readonly Track[] }) {
  const [confirming, setConfirming] = useState(false);
  const ids = tracks.map((t) => t.id);
  const set = (flag: "muted" | "solo", value: boolean) => projectStore.set((p) => ids.reduce((acc, id) => updateTrack(acc, id, { [flag]: value }), p));
  const allMuted = tracks.every((t) => t.muted);
  const allSolo = tracks.every((t) => t.solo);
  return (
    <aside className="arr-inspector arr-trackbar" aria-label="Selected tracks">
      <div className="insp-id">
        <div>
          <div className="insp-name">{tracks.length} tracks selected</div>
          <div className="mono insp-meta">Edits apply to all</div>
        </div>
      </div>
      <div className="insp-actions tb-left">
        <button type="button" className={`btn btn-sm${allMuted ? " on" : ""}`} aria-pressed={allMuted} onClick={() => set("muted", !allMuted)}>
          Mute
        </button>
        <button type="button" className={`btn btn-sm${allSolo ? " on" : ""}`} aria-pressed={allSolo} onClick={() => set("solo", !allSolo)}>
          Solo
        </button>
        <button type="button" className="btn btn-sm" onClick={() => selectTrackClips(ids)}>
          Select clips
        </button>
      </div>
      <div className="pop-swatches inline" role="group" aria-label="Colour all selected tracks">
        {TRACK_COLORS.map((c) => (
          <button key={c} type="button" aria-label={`Colour ${c}`} style={{ "--c": c } as CSSProperties} onClick={() => colorTracks(ids, c)} />
        ))}
      </div>
      <div className="insp-actions">
        <button type="button" className="btn btn-sm" onClick={clearTrackSelection}>
          Deselect
        </button>
        {confirming ? (
          <button type="button" className="btn btn-danger btn-sm" onClick={() => (deleteTracks(ids), setConfirming(false))}>
            Delete {tracks.length} tracks: confirm
          </button>
        ) : (
          <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirming(true)}>
            Delete
          </button>
        )}
      </div>
    </aside>
  );
}
