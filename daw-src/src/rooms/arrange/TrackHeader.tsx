import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { renameTrack, setTrackMix } from "../../project/actions";
import type { Track } from "../../project/model";
import { TRACK_COLORS } from "../../project/actions";
import { projectStore } from "../../store/project";
import { KindIcon, type TrackIconKind } from "./icons";
import { PopMenu } from "./Popover";
import { colorTracks, deleteTracks, selectTrackClips, shiftTrack, toggleTrackFlag } from "./ops";
import { pickTrack, tracksFor } from "./selection";
import { HeadSlider } from "./HeadSlider";
import { formatGain, formatPanShort, gainToPos, nudgeGain, nudgePan, panToPos, posToGain, posToPan } from "./trackMix";
import { FADER_MAX_DB, FADER_MIN_DB } from "../../audio/mixMath";
import { Slider } from "../../ui/controls";
import { isCompact, useLayoutMode } from "../../ui/layoutMode";
import "./mix.css";

interface Props {
  track: Track;
  icon: TrackIconKind;
  /** Only worth a second line when it names something the icon cannot, such as the instrument. */
  detail?: string;
  selected: boolean;
  index: number;
  count: number;
}

export const TrackHeader = memo(function TrackHeader({ track, icon, detail, selected, index, count }: Props) {
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [readout, setReadout] = useState<string | null>(null);
  // Phones hide the header's small sliders; volume and pan move into the track's menu as finger-sized sliders.
  const compact = isCompact(useLayoutMode());
  const showVolume = useCallback((t: string | null) => setReadout(t && `Volume ${t}`), []);
  const showPan = useCallback((t: string | null) => setReadout(t && `Pan ${t}`), []);
  // The same Track.gainDb / Track.pan the Mixer strip edits, so the two stay one control.
  const mix = (m: { gainDb?: number; pan?: number }) => projectStore.set((p) => setTrackMix(p, track.id, m));

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const commit = (value: string) => {
    setEditing(false);
    projectStore.set((p) => renameTrack(p, track.id, value));
  };
  const group = () => tracksFor(track.id);
  const closeMenu = () => {
    setMenu(null);
    setConfirming(false);
  };

  return (
    <div
      className={`arr-head${selected ? " sel" : ""}${track.muted ? " muted" : ""}`}
      style={{ "--c": track.color } as CSSProperties}
      data-track-head={track.id}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest(".arr-btns, .arr-resize, input, .hs")) return;
        pickTrack(track.id, e.shiftKey ? "range" : e.metaKey || e.ctrlKey ? "toggle" : "only");
      }}
    >
      <span className="arr-color" aria-hidden="true" />
      <span className="arr-kind" title={detail}>
        <KindIcon kind={icon} />
      </span>
      <div className="arr-meta">
        {editing ? (
          <input
            ref={input}
            className="arr-rename"
            defaultValue={track.name}
            aria-label="Track name"
            onBlur={(e) => commit(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit(e.currentTarget.value);
              if (e.key === "Escape") setEditing(false);
              e.stopPropagation();
            }}
          />
        ) : (
          <div className="arr-name" title="Double-click to rename" onDoubleClick={() => setEditing(true)}>
            {track.name}
          </div>
        )}
        <div className="arr-sub-swap">
          <div className="arr-sub" aria-hidden={readout !== null}>
            {detail && detail !== track.name ? detail : ""}
          </div>
          <div className="arr-readout mono" aria-hidden="true">
            {readout ?? ""}
          </div>
        </div>
        <div className="arr-mix">
          <HeadSlider
            className="hs-vol"
            label={`${track.name} volume`}
            pos={gainToPos(track.gainDb)}
            valueText={formatGain(track.gainDb)}
            onPos={(pos) => mix({ gainDb: posToGain(pos) })}
            onStep={(d, fine) => mix({ gainDb: nudgeGain(track.gainDb, d, fine) })}
            onHome={() => mix({ gainDb: FADER_MIN_DB })}
            onEnd={() => mix({ gainDb: FADER_MAX_DB })}
            onReset={() => mix({ gainDb: 0 })}
            onReadout={showVolume}
          />
          <HeadSlider
            className="hs-pan"
            bipolar
            label={`${track.name} pan`}
            pos={panToPos(track.pan)}
            valueText={formatPanShort(track.pan)}
            onPos={(pos, dragging) => mix({ pan: posToPan(pos, dragging) })}
            onStep={(d, fine) => mix({ pan: nudgePan(track.pan, d, fine) })}
            onHome={() => mix({ pan: -1 })}
            onEnd={() => mix({ pan: 1 })}
            onReset={() => mix({ pan: 0 })}
            onReadout={showPan}
          />
        </div>
      </div>
      <div className="arr-btns">
        <button
          type="button"
          className={`mini-btn${track.muted ? " on-mute" : ""}`}
          aria-pressed={track.muted}
          aria-label={`Mute ${track.name}`}
          onClick={() => toggleTrackFlag(track.id, "muted", group())}
        >
          M
        </button>
        <button
          type="button"
          className={`mini-btn${track.solo ? " on-solo" : ""}`}
          aria-pressed={track.solo}
          aria-label={`Solo ${track.name}`}
          onClick={() => toggleTrackFlag(track.id, "solo", group())}
        >
          S
        </button>
        <button
          type="button"
          className="mini-more"
          aria-haspopup="menu"
          aria-label={`More for ${track.name}`}
          onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        </button>
      </div>
      <span className="arr-resize" role="separator" aria-orientation="vertical" aria-label="Resize track list" />
      {menu && (
        <PopMenu anchor={menu} onClose={closeMenu} label={`${track.name} options`}>
          {compact && (
            <div className="pm-mix" style={{ "--c": track.color } as CSSProperties}>
              <Slider label="Volume" value={track.gainDb} min={FADER_MIN_DB} max={FADER_MAX_DB} step={0.5} format={formatGain} onChange={(gainDb) => mix({ gainDb })} />
              <Slider label="Pan" value={track.pan} min={-1} max={1} step={0.02} format={formatPanShort} onChange={(pan) => mix({ pan })} />
            </div>
          )}
          <button type="button" role="menuitem" onClick={() => (closeMenu(), setEditing(true))}>
            Rename
          </button>
          <button type="button" role="menuitem" disabled={index === 0} onClick={() => (shiftTrack(track.id, -1), closeMenu())}>
            Move up
          </button>
          <button type="button" role="menuitem" disabled={index === count - 1} onClick={() => (shiftTrack(track.id, 1), closeMenu())}>
            Move down
          </button>
          <button type="button" role="menuitem" onClick={() => (selectTrackClips(group()), closeMenu())}>
            Select all clips
          </button>
          <hr className="pm-sep" />
          <div className="pop-swatches" role="group" aria-label="Track colour">
            {TRACK_COLORS.map((c) => (
              <button key={c} type="button" role="menuitem" aria-label={`Colour ${c}`} style={{ "--c": c } as CSSProperties} className={c === track.color ? "on" : ""} onClick={() => (colorTracks(group(), c), closeMenu())} />
            ))}
          </div>
          <hr className="pm-sep" />
          {confirming ? (
            <button type="button" role="menuitem" className="danger" onClick={() => (deleteTracks(group()), closeMenu())}>
              {group().length > 1 ? `Delete ${group().length} tracks` : track.clips.length > 0 ? `Delete track and ${track.clips.length} clip${track.clips.length === 1 ? "" : "s"}` : "Delete track"}: confirm
            </button>
          ) : (
            <button type="button" role="menuitem" className="danger" onClick={() => setConfirming(true)}>
              {group().length > 1 ? `Delete ${group().length} tracks` : "Delete track"}
            </button>
          )}
        </PopMenu>
      )}
    </div>
  );
});
