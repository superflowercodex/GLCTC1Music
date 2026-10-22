import { useEffect, useRef, useState, type ReactNode } from "react";
import { Cover } from "../gfx/Cover";
import { useProjectPalette } from "../gfx/useProjectPalette";
import { describeSaveStatus, persistence, saveStatusStore } from "../project/persist";
import { projectStore } from "../store/project";
import { useStore } from "../store/store";
import { InfoChip } from "./controls";
import { useRaf } from "./hooks";
import { peekEngine } from "../audio/engine";

/** The project's name as a big title that renames in place (Enter or blur saves, Escape cancels). */
function ProjectName() {
  const id = useStore(projectStore, (p) => p.id);
  const name = useStore(projectStore, (p) => p.name);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const commit = (): void => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== name) void persistence().renameProject(id, next).catch(() => setDraft(name));
    else setDraft(name);
  };

  if (editing)
    return (
      <input
        ref={input}
        className="proj-name"
        aria-label="Project name"
        value={draft}
        maxLength={80}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(name);
            setEditing(false);
          }
        }}
      />
    );
  return (
    <h1 className="proj-name-h">
      <button type="button" className="proj-name" title="Rename project" onClick={() => { setDraft(name); setEditing(true); }}>
        {name}
      </button>
    </h1>
  );
}

/** "Saving" and "Saved" share one width, so the chip holds still while autosave runs. */
const SAVE_SLOT = 6;
const SAVE_TEXT = { idle: "Autosave on", saving: "Saving", saved: "Saved", error: "Not saved" } as const;
const SAVE_TONE = { idle: "quiet", saving: "saving", saved: "ok", error: "warn" } as const;

/** Save state as a chip; when a save failed it becomes the retry button. */
export function SaveChip() {
  const status = useStore(saveStatusStore, (s) => s);
  const chip = (
    <InfoChip tone={SAVE_TONE[status.state]} title={describeSaveStatus(status)} slot={SAVE_SLOT}>
      {SAVE_TEXT[status.state]}
    </InfoChip>
  );
  if (status.state !== "error") return chip;
  return (
    <button type="button" className="ichip-btn" onClick={() => void persistence().saveNow().catch(() => undefined)} aria-label="Not saved. Try saving again">
      {chip}
    </button>
  );
}

/** The cover breathes with the music while the transport runs. */
function useEnginePlaying(): boolean {
  const [playing, setPlaying] = useState(false);
  useRaf(() => {
    const now = peekEngine()?.clock.playing ?? false;
    setPlaying((prev) => (prev === now ? prev : now));
  });
  return playing;
}

/**
 * Album-page header for the rooms that work on the whole project: its cover lit from behind, a tracked
 * eyebrow, the name as a big editable title and info chips (key, tempo, length, save state).
 */
export function ProjectHeader({ room, chips }: { room: string; chips: ReactNode }) {
  const palette = useProjectPalette();
  const playing = useEnginePlaying();
  return (
    <div className="proj-head">
      <div className="cover-glow">
        <Cover palette={palette} playing={playing} />
      </div>
      <div className="proj-head-text">
        <span className="eyebrow">Studio · {room}</span>
        <div className="proj-head-line">
          <ProjectName />
          <div className="ichips">
            {chips}
            <SaveChip />
          </div>
        </div>
      </div>
    </div>
  );
}
