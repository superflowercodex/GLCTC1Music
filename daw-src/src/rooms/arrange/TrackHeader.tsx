import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { renameTrack } from "../../project/actions";
import type { Track } from "../../project/model";
import { projectStore, uiStore } from "../../store/project";
import { deleteTrack, shiftTrack, toggleTrackFlag } from "./ops";

export function PopMenu({ anchor, onClose, children, label }: { anchor: DOMRect; onClose: () => void; children: React.ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", esc);
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  const below = anchor.bottom + 240 < window.innerHeight;
  const style: CSSProperties = {
    left: Math.min(anchor.left, window.innerWidth - 230),
    ...(below ? { top: anchor.bottom + 6 } : { bottom: window.innerHeight - anchor.top + 6 }),
  };
  return createPortal(
    <div ref={ref} className="pop-menu" role="menu" aria-label={label} style={style}>
      {children}
    </div>,
    document.body,
  );
}

interface Props {
  track: Track;
  subtitle: string;
  selected: boolean;
  index: number;
  count: number;
}

export const TrackHeader = memo(function TrackHeader({ track, subtitle, selected, index, count }: Props) {
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const commit = (value: string) => {
    setEditing(false);
    projectStore.set((p) => renameTrack(p, track.id, value));
  };
  const closeMenu = () => {
    setMenu(null);
    setConfirming(false);
  };

  return (
    <div
      className={`arr-head${selected ? " sel" : ""}${track.muted ? " muted" : ""}`}
      style={{ "--c": track.color } as CSSProperties}
      onPointerDown={() => uiStore.set((s) => ({ ...s, selectedTrackId: track.id }))}
    >
      <span className="arr-color" aria-hidden="true" />
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
        <div className="arr-sub">{subtitle}</div>
      </div>
      <div className="arr-btns">
        <button
          type="button"
          className={`mini-btn${track.muted ? " on-mute" : ""}`}
          aria-pressed={track.muted}
          aria-label={`Mute ${track.name}`}
          onClick={() => toggleTrackFlag(track.id, "muted")}
        >
          M
        </button>
        <button
          type="button"
          className={`mini-btn${track.solo ? " on-solo" : ""}`}
          aria-pressed={track.solo}
          aria-label={`Solo ${track.name}`}
          onClick={() => toggleTrackFlag(track.id, "solo")}
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
          ···
        </button>
      </div>
      {menu && (
        <PopMenu anchor={menu} onClose={closeMenu} label={`${track.name} options`}>
          <button type="button" role="menuitem" onClick={() => (closeMenu(), setEditing(true))}>
            Rename
          </button>
          <button type="button" role="menuitem" disabled={index === 0} onClick={() => (shiftTrack(track.id, -1), closeMenu())}>
            Move up
          </button>
          <button type="button" role="menuitem" disabled={index === count - 1} onClick={() => (shiftTrack(track.id, 1), closeMenu())}>
            Move down
          </button>
          {confirming ? (
            <button type="button" role="menuitem" className="danger" onClick={() => (deleteTrack(track.id), closeMenu())}>
              {track.clips.length > 0 ? `Delete track and ${track.clips.length} clip${track.clips.length === 1 ? "" : "s"}` : "Delete track"}: confirm
            </button>
          ) : (
            <button type="button" role="menuitem" className="danger" onClick={() => setConfirming(true)}>
              Delete track
            </button>
          )}
        </PopMenu>
      )}
    </div>
  );
});
